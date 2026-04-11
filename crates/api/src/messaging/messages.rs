use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::{Path, Query, State};
use base64::{Engine, engine::general_purpose::STANDARD};
use sea_orm::ActiveValue::Set;
use sea_orm::TransactionTrait;
use uuid::Uuid;

use crate::AppState;
use eulesia_auth::session::AuthUser;
use eulesia_common::error::ApiError;
use eulesia_common::types::{ConversationType, MessageType, new_id};
use eulesia_db::entities::{message_device_queue, messages};
use eulesia_db::repo::conversations::ConversationRepo;
use eulesia_db::repo::devices::DeviceRepo;
use eulesia_db::repo::memberships::MembershipRepo;
use eulesia_db::repo::messages::MessageRepo;

use super::types::{MessageCursorParams, MessageResponse, SendMessageRequest};

const DEFAULT_LIMIT: u64 = 50;
const MAX_LIMIT: u64 = 100;

#[allow(clippy::needless_pass_by_value)]
fn db_err(e: sea_orm::DbErr) -> ApiError {
    ApiError::Database(e.to_string())
}

fn decode_base64(input: &str, field: &str) -> Result<Vec<u8>, ApiError> {
    let bytes = STANDARD
        .decode(input)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(input))
        .map_err(|_| ApiError::BadRequest(format!("invalid base64 in {field}")))?;
    if bytes.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(bytes)
}

fn resolve_e2ee_sender_device(
    auth_device_id: Option<Uuid>,
    requested_device_id: Option<Uuid>,
) -> Result<Uuid, ApiError> {
    match (auth_device_id, requested_device_id) {
        (Some(auth_device_id), Some(requested_device_id))
            if auth_device_id != requested_device_id =>
        {
            Err(ApiError::BadRequest(
                "sender_device_id must match the authenticated device".into(),
            ))
        }
        (Some(auth_device_id), _) => Ok(auth_device_id),
        (None, Some(requested_device_id)) => Ok(requested_device_id),
        (None, None) => Err(ApiError::BadRequest(
            "sender_device_id required for E2EE messages".into(),
        )),
    }
}

// ---------------------------------------------------------------------------
// Prepared send — intermediate representation before persistence
// ---------------------------------------------------------------------------

struct PreparedSend {
    stored_ciphertext: Vec<u8>,
    queue_entries: Vec<message_device_queue::ActiveModel>,
}

fn message_uses_device_queue(conv_type: ConversationType, message_type: &str) -> bool {
    conv_type == ConversationType::Direct || message_type == MessageType::ToDevice.as_str()
}

fn ciphertext_for_viewer(
    msg: &messages::Model,
    conv_type: ConversationType,
    viewer_device_id: Option<Uuid>,
    device_ct_map: &HashMap<Uuid, Vec<u8>>,
) -> String {
    if !message_uses_device_queue(conv_type, &msg.message_type) {
        return msg
            .ciphertext
            .as_ref()
            .map(|ct| STANDARD.encode(ct))
            .unwrap_or_default();
    }

    let Some(device_id) = viewer_device_id else {
        return String::new();
    };

    if msg.sender_device_id == Some(device_id) {
        return msg
            .ciphertext
            .as_ref()
            .map(|ct| STANDARD.encode(ct))
            .unwrap_or_default();
    }

    device_ct_map
        .get(&msg.id)
        .map(|ct| STANDARD.encode(ct))
        .unwrap_or_default()
}

fn broadcast_ciphertext(uses_device_queue: bool, stored_ciphertext: Option<&[u8]>) -> String {
    if uses_device_queue {
        return String::new();
    }

    stored_ciphertext
        .map(|ct| STANDARD.encode(ct))
        .unwrap_or_default()
}

/// Prepare a per-device send: validate device ciphertexts, build queue entries.
async fn prepare_device_queued_send<C: sea_orm::ConnectionTrait>(
    txn: &C,
    req: &SendMessageRequest,
    device_id: Uuid,
    conversation_id: Uuid,
    msg_id: Uuid,
    now: chrono::DateTime<chrono::FixedOffset>,
) -> Result<PreparedSend, ApiError> {
    let device_cts = req.device_ciphertexts.as_ref().ok_or_else(|| {
        ApiError::BadRequest("device_ciphertexts is required for per-device messages".into())
    })?;

    if device_cts.is_empty() {
        return Err(ApiError::BadRequest(
            "device_ciphertexts must not be empty".into(),
        ));
    }

    // DM encryption cannot reliably produce an Olm to-device event for the
    // sender's currently active device. When the client omits that copy, keep
    // the canonical sender ciphertext empty and serve the sender's own history
    // from the local browser cache instead.
    let sender_ct = device_cts
        .get(&device_id)
        .map(|b64| decode_base64(b64, "device_ciphertexts[sender]"))
        .transpose()?
        .unwrap_or_default();

    // Validate target devices: only allow active devices belonging to
    // conversation participants.
    let members = MembershipRepo::list_active(txn, conversation_id)
        .await
        .map_err(db_err)?;
    let member_user_ids: Vec<Uuid> = members.iter().map(|m| m.user_id).collect();
    let all_devs = DeviceRepo::list_enrolled_for_users(txn, &member_user_ids)
        .await
        .map_err(db_err)?;
    let valid_devices: HashSet<Uuid> = all_devs.iter().map(|d| d.id).collect();
    for target_id in device_cts.keys() {
        if !valid_devices.contains(target_id) {
            return Err(ApiError::BadRequest(format!(
                "invalid or revoked device: {target_id}"
            )));
        }
    }

    // Build per-device queue entries (skip sender's current device).
    let mut entries = Vec::new();
    for (target_device_id, ct_b64) in device_cts {
        if *target_device_id == device_id {
            continue;
        }
        let ct = decode_base64(ct_b64, "device_ciphertexts")?;
        entries.push(message_device_queue::ActiveModel {
            message_id: Set(msg_id),
            device_id: Set(*target_device_id),
            ciphertext: Set(ct),
            enqueued_at: Set(now),
            delivered_at: Set(None),
            failed_at: Set(None),
            attempt_count: Set(0),
        });
    }

    Ok(PreparedSend {
        stored_ciphertext: sender_ct,
        queue_entries: entries,
    })
}

/// Prepare a group/channel send: single Megolm room-event ciphertext fanned out.
async fn prepare_group_send<C: sea_orm::ConnectionTrait>(
    txn: &C,
    req: &SendMessageRequest,
    device_id: Uuid,
    conversation_id: Uuid,
    msg_id: Uuid,
    now: chrono::DateTime<chrono::FixedOffset>,
) -> Result<PreparedSend, ApiError> {
    let ct_b64 = req
        .ciphertext
        .as_ref()
        .ok_or_else(|| ApiError::BadRequest("ciphertext is required for group messages".into()))?;
    let ct = decode_base64(ct_b64, "ciphertext")?;

    // Fan out to all member devices except sender's current device.
    let active_members = MembershipRepo::list_active(txn, conversation_id)
        .await
        .map_err(db_err)?;
    let member_user_ids: Vec<Uuid> = active_members.iter().map(|m| m.user_id).collect();
    let all_devices = DeviceRepo::list_enrolled_for_users(txn, &member_user_ids)
        .await
        .map_err(db_err)?;

    let mut entries = Vec::new();
    for dev in &all_devices {
        if dev.id == device_id {
            continue;
        }
        entries.push(message_device_queue::ActiveModel {
            message_id: Set(msg_id),
            device_id: Set(dev.id),
            ciphertext: Set(ct.clone()),
            enqueued_at: Set(now),
            delivered_at: Set(None),
            failed_at: Set(None),
            attempt_count: Set(0),
        });
    }

    Ok(PreparedSend {
        stored_ciphertext: ct,
        queue_entries: entries,
    })
}

// ---------------------------------------------------------------------------
// POST /conversations/{id}/messages
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_lines)]
pub async fn send(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(conversation_id): Path<Uuid>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    let caller = auth.user_id.0;

    let msg_id = new_id();
    let now = chrono::Utc::now().fixed_offset();

    let txn = state
        .db
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Single authoritative read inside lock — fetch type + epoch + encryption together.
    let (conv_type, current_epoch, encryption) = {
        use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
        let row = txn
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "SELECT type, current_epoch, encryption FROM conversations WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
                [conversation_id.into()],
            ))
            .await
            .map_err(db_err)?
            .ok_or_else(|| ApiError::NotFound("conversation not found".into()))?;

        let type_str: String = row
            .try_get_by_index(0)
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        let epoch: i64 = row
            .try_get_by_index(1)
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        let enc: String = row
            .try_get_by_index(2)
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        let conv_type = type_str
            .parse::<ConversationType>()
            .map_err(ApiError::Internal)?;
        (conv_type, epoch, enc)
    };

    // Re-check membership inside the locked transaction to prevent a
    // removed user from sending after their membership was revoked.
    MembershipRepo::find_active(&txn, conversation_id, caller)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Forbidden)?;

    // Use E2EE path when the client provides ciphertext; fall back to
    // plaintext storage otherwise. E2EE-capable clients always provide
    // device_ciphertexts (DMs) or ciphertext (groups).
    let has_e2ee_payload = req.device_ciphertexts.is_some() || req.ciphertext.is_some();
    let is_plaintext = !has_e2ee_payload;

    // Reject plaintext sends on E2EE conversations — clients must provide
    // device_ciphertexts (DMs) or ciphertext (groups).
    if is_plaintext && encryption == "e2ee" {
        return Err(ApiError::BadRequest(
            "plaintext messages are not allowed in end-to-end encrypted conversations".into(),
        ));
    }

    if is_plaintext {
        // Plaintext path — no device binding, no ciphertext, no device queue.
        let content = req.content.as_ref().ok_or_else(|| {
            ApiError::BadRequest("content is required for plaintext conversations".into())
        })?;

        let msg = MessageRepo::create(
            &txn,
            messages::ActiveModel {
                id: Set(msg_id),
                conversation_id: Set(conversation_id),
                sender_id: Set(caller),
                sender_device_id: Set(None),
                epoch: Set(current_epoch),
                ciphertext: Set(Some(content.as_bytes().to_vec())),
                message_type: Set(req.message_type.as_str().to_string()),
                server_ts: Set(now),
            },
        )
        .await
        .map_err(db_err)?;

        txn.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        // Broadcast to other members via WebSocket using stored bytes as base64
        let broadcast_ct = broadcast_ciphertext(false, msg.ciphertext.as_deref());
        eulesia_ws::handler::broadcast_new_message(
            &state.db,
            &state.ws_registry,
            conversation_id,
            msg.id,
            caller,
            auth.device_id.map(|d| d.0),
            &broadcast_ct,
            current_epoch,
        )
        .await;

        let mut resp = MessageResponse::from_model(&msg);
        resp.content = msg
            .ciphertext
            .as_ref()
            .and_then(|ct| String::from_utf8(ct.clone()).ok());
        resp.ciphertext = String::new();
        return Ok(Json(resp));
    }

    // E2EE path — resolve device ID from session or request body.
    let device_id = resolve_e2ee_sender_device(auth.device_id.map(|d| d.0), req.sender_device_id)?;

    // Verify the device belongs to the caller, is active, and is enrolled
    // (has uploaded Matrix identity keys). This prevents unenrolled device
    // shells from sending ciphertext that recipients cannot decrypt.
    let dev = DeviceRepo::find_by_id_and_user(&state.db, device_id, caller)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::BadRequest("device not found or not owned by caller".into()))?;
    if dev.revoked_at.is_some() {
        return Err(ApiError::BadRequest("device is revoked".into()));
    }
    if dev.matrix_curve25519_key.is_none()
        || dev.matrix_ed25519_key.is_none()
        || dev.matrix_device_signature.is_none()
    {
        return Err(ApiError::BadRequest(
            "device must have Matrix keys uploaded before sending E2EE messages".into(),
        ));
    }

    let prepared = match conv_type {
        ConversationType::Direct => {
            prepare_device_queued_send(&txn, &req, device_id, conversation_id, msg_id, now).await?
        }
        ConversationType::Group | ConversationType::Channel => {
            if req.message_type == MessageType::ToDevice {
                // Hidden Matrix to-device protocol payloads use per-device
                // ciphertexts even in group conversations.
                prepare_device_queued_send(&txn, &req, device_id, conversation_id, msg_id, now)
                    .await?
            } else {
                prepare_group_send(&txn, &req, device_id, conversation_id, msg_id, now).await?
            }
        }
    };

    // Unified persistence path — one insert + one fanout + one commit.
    let msg = MessageRepo::create(
        &txn,
        messages::ActiveModel {
            id: Set(msg_id),
            conversation_id: Set(conversation_id),
            sender_id: Set(caller),
            sender_device_id: Set(Some(device_id)),
            epoch: Set(current_epoch),
            ciphertext: Set(Some(prepared.stored_ciphertext)),
            message_type: Set(req.message_type.as_str().to_string()),
            server_ts: Set(now),
        },
    )
    .await
    .map_err(db_err)?;

    MessageRepo::create_queue_entries(&txn, prepared.queue_entries)
        .await
        .map_err(db_err)?;

    txn.commit()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Broadcast to other members via WebSocket using stored ciphertext as base64
    let broadcast_ct = broadcast_ciphertext(
        message_uses_device_queue(conv_type, req.message_type.as_str()),
        msg.ciphertext.as_deref(),
    );
    eulesia_ws::handler::broadcast_new_message(
        &state.db,
        &state.ws_registry,
        conversation_id,
        msg.id,
        caller,
        auth.device_id.map(|d| d.0),
        &broadcast_ct,
        current_epoch,
    )
    .await;

    Ok(Json(MessageResponse::from_model(&msg)))
}

// ---------------------------------------------------------------------------
// GET /conversations/{id}/messages
// ---------------------------------------------------------------------------

pub async fn list_messages(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(conversation_id): Path<Uuid>,
    Query(params): Query<MessageCursorParams>,
) -> Result<Json<Vec<MessageResponse>>, ApiError> {
    // Verify conversation exists and read its type + encryption.
    let conv = ConversationRepo::find_by_id(&state.db, conversation_id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("conversation not found".into()))?;

    let conv_type = conv
        .r#type
        .parse::<ConversationType>()
        .map_err(ApiError::Internal)?;
    let is_plaintext = conv.encryption == "none";

    // Verify caller is active member.
    MembershipRepo::find_active(&*state.db, conversation_id, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Forbidden)?;

    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);

    let msgs = ConversationRepo::messages_page(
        &state.db,
        conversation_id,
        params.before,
        limit,
        params.message_type.as_ref().map(MessageType::as_str),
    )
    .await
    .map_err(db_err)?;

    if is_plaintext {
        // Plaintext path — decode stored bytes as UTF-8 content.
        let items = msgs
            .iter()
            .map(|m| {
                let content = m
                    .ciphertext
                    .as_ref()
                    .and_then(|ct| String::from_utf8(ct.clone()).ok());
                MessageResponse {
                    id: m.id,
                    conversation_id: m.conversation_id,
                    sender_id: m.sender_id,
                    sender_device_id: m.sender_device_id,
                    epoch: m.epoch,
                    ciphertext: String::new(),
                    content,
                    message_type: m.message_type.clone(),
                    server_ts: m.server_ts.to_rfc3339(),
                }
            })
            .collect();
        return Ok(Json(items));
    }

    let device_id = auth.device_id.map(|d| d.0);
    let msg_ids: Vec<Uuid> = msgs.iter().map(|m| m.id).collect();

    let device_ct_map: HashMap<Uuid, Vec<u8>> = if device_id.is_some()
        && msgs
            .iter()
            .any(|msg| message_uses_device_queue(conv_type, &msg.message_type))
    {
        if let Some(did) = device_id {
            let entries = MessageRepo::get_device_ciphertexts(&*state.db, &msg_ids, did)
                .await
                .map_err(db_err)?;
            entries
                .into_iter()
                .map(|e| (e.message_id, e.ciphertext))
                .collect()
        } else {
            HashMap::new()
        }
    } else {
        HashMap::new()
    };

    let items = msgs
        .iter()
        .map(|m| {
            // Messages without a sender_device_id were stored via the
            // plaintext fallback path — decode their ciphertext as UTF-8
            // content even in E2EE conversations.
            if m.sender_device_id.is_none() {
                let content = m
                    .ciphertext
                    .as_ref()
                    .and_then(|ct| String::from_utf8(ct.clone()).ok());
                return MessageResponse {
                    id: m.id,
                    conversation_id: m.conversation_id,
                    sender_id: m.sender_id,
                    sender_device_id: None,
                    epoch: m.epoch,
                    ciphertext: String::new(),
                    content,
                    message_type: m.message_type.clone(),
                    server_ts: m.server_ts.to_rfc3339(),
                };
            }

            MessageResponse {
                id: m.id,
                conversation_id: m.conversation_id,
                sender_id: m.sender_id,
                sender_device_id: m.sender_device_id,
                epoch: m.epoch,
                ciphertext: ciphertext_for_viewer(m, conv_type, device_id, &device_ct_map),
                content: None,
                message_type: m.message_type.clone(),
                server_ts: m.server_ts.to_rfc3339(),
            }
        })
        .collect();

    Ok(Json(items))
}

// ---------------------------------------------------------------------------
// PATCH /conversations/{id}/messages/{message_id} — edit message (plaintext only)
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditMessageRequest {
    pub content: String,
}

pub async fn edit_message(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((conversation_id, message_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<EditMessageRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    use sea_orm::ActiveModelTrait;

    let conv = ConversationRepo::find_by_id(&state.db, conversation_id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("conversation not found".into()))?;

    if conv.encryption != "none" {
        return Err(ApiError::BadRequest(
            "only plaintext messages can be edited".into(),
        ));
    }

    // Verify membership
    MembershipRepo::find_active(&*state.db, conversation_id, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Forbidden)?;

    // Find message, verify it belongs to this conversation, and verify ownership
    let msg = MessageRepo::find_by_id(&*state.db, message_id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("message not found".into()))?;

    if msg.conversation_id != conversation_id {
        return Err(ApiError::NotFound("message not found".into()));
    }
    if msg.sender_id != auth.user_id.0 {
        return Err(ApiError::Forbidden);
    }

    // Update content
    let mut am: messages::ActiveModel = msg.into();
    am.ciphertext = Set(Some(req.content.as_bytes().to_vec()));
    let updated = am.update(&*state.db).await.map_err(db_err)?;

    let mut resp = MessageResponse::from_model(&updated);
    resp.content = updated
        .ciphertext
        .as_ref()
        .and_then(|ct| String::from_utf8(ct.clone()).ok());
    resp.ciphertext = String::new();
    Ok(Json(resp))
}

// ---------------------------------------------------------------------------
// DELETE /conversations/{id}/messages/{message_id} — soft-delete
// ---------------------------------------------------------------------------

pub async fn delete_message(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((conversation_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    use eulesia_db::entities::message_redactions;
    use sea_orm::ActiveModelTrait;

    // Verify membership
    MembershipRepo::find_active(&*state.db, conversation_id, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Forbidden)?;

    let msg = MessageRepo::find_by_id(&*state.db, message_id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("message not found".into()))?;

    if msg.conversation_id != conversation_id {
        return Err(ApiError::NotFound("message not found".into()));
    }
    if msg.sender_id != auth.user_id.0 {
        return Err(ApiError::Forbidden);
    }

    // Soft-delete via message_redactions
    let now = chrono::Utc::now().fixed_offset();
    message_redactions::ActiveModel {
        message_id: Set(message_id),
        redacted_by: Set(auth.user_id.0),
        reason: Set("user_deleted".into()),
        created_at: Set(now),
    }
    .insert(&*state.db)
    .await
    .map_err(db_err)?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ---------------------------------------------------------------------------
// POST /conversations/{id}/read — mark conversation as read
// ---------------------------------------------------------------------------

pub async fn mark_read(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(conversation_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    use eulesia_db::entities::memberships;
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::Expr};

    // Verify membership
    MembershipRepo::find_active(&*state.db, conversation_id, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Forbidden)?;

    // Set last_read_at = NOW() on the caller's active membership row.
    memberships::Entity::update_many()
        .filter(memberships::Column::ConversationId.eq(conversation_id))
        .filter(memberships::Column::UserId.eq(auth.user_id.0))
        .filter(memberships::Column::LeftAt.is_null())
        .col_expr(
            memberships::Column::LastReadAt,
            Expr::current_timestamp().into(),
        )
        .exec(&*state.db)
        .await
        .map_err(db_err)?;

    Ok(Json(serde_json::json!({ "read": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_message(
        message_type: MessageType,
        sender_device_id: Option<Uuid>,
        ciphertext: &[u8],
    ) -> messages::Model {
        messages::Model {
            id: Uuid::now_v7(),
            conversation_id: Uuid::now_v7(),
            sender_id: Uuid::now_v7(),
            sender_device_id,
            epoch: 0,
            ciphertext: Some(ciphertext.to_vec()),
            message_type: message_type.as_str().to_string(),
            server_ts: chrono::Utc::now().fixed_offset(),
        }
    }

    #[test]
    fn direct_sender_device_uses_stored_ciphertext() {
        let sender_device_id = Uuid::now_v7();
        let msg = make_message(MessageType::Text, Some(sender_device_id), b"sender-copy");

        let ciphertext = ciphertext_for_viewer(
            &msg,
            ConversationType::Direct,
            Some(sender_device_id),
            &HashMap::new(),
        );

        assert_eq!(ciphertext, STANDARD.encode(b"sender-copy"));
    }

    #[test]
    fn direct_sender_device_without_stored_ciphertext_returns_empty() {
        let sender_device_id = Uuid::now_v7();
        let mut msg = make_message(MessageType::Text, Some(sender_device_id), b"sender-copy");
        msg.ciphertext = None;

        let ciphertext = ciphertext_for_viewer(
            &msg,
            ConversationType::Direct,
            Some(sender_device_id),
            &HashMap::new(),
        );

        assert!(ciphertext.is_empty());
    }

    #[test]
    fn direct_recipient_device_uses_queue_ciphertext() {
        let msg = make_message(MessageType::Text, Some(Uuid::now_v7()), b"sender-copy");
        let viewer_device_id = Uuid::now_v7();
        let queue_ciphertexts = HashMap::from([(msg.id, b"recipient-copy".to_vec())]);

        let ciphertext = ciphertext_for_viewer(
            &msg,
            ConversationType::Direct,
            Some(viewer_device_id),
            &queue_ciphertexts,
        );

        assert_eq!(ciphertext, STANDARD.encode(b"recipient-copy"));
    }

    #[test]
    fn group_to_device_recipient_uses_queue_ciphertext() {
        let msg = make_message(MessageType::ToDevice, Some(Uuid::now_v7()), b"sender-copy");
        let viewer_device_id = Uuid::now_v7();
        let queue_ciphertexts = HashMap::from([(msg.id, b"recipient-to-device".to_vec())]);

        let ciphertext = ciphertext_for_viewer(
            &msg,
            ConversationType::Group,
            Some(viewer_device_id),
            &queue_ciphertexts,
        );

        assert_eq!(ciphertext, STANDARD.encode(b"recipient-to-device"));
    }

    #[test]
    fn group_to_device_without_queue_entry_returns_empty_ciphertext() {
        let msg = make_message(MessageType::ToDevice, Some(Uuid::now_v7()), b"sender-copy");

        let ciphertext = ciphertext_for_viewer(
            &msg,
            ConversationType::Group,
            Some(Uuid::now_v7()),
            &HashMap::new(),
        );

        assert!(ciphertext.is_empty());
    }

    #[test]
    fn group_text_uses_stored_ciphertext() {
        let msg = make_message(MessageType::Text, Some(Uuid::now_v7()), b"group-message");
        let queue_ciphertexts = HashMap::from([(msg.id, b"recipient-copy".to_vec())]);

        let ciphertext = ciphertext_for_viewer(
            &msg,
            ConversationType::Group,
            Some(Uuid::now_v7()),
            &queue_ciphertexts,
        );

        assert_eq!(ciphertext, STANDARD.encode(b"group-message"));
    }

    #[test]
    fn per_device_broadcasts_do_not_publish_sender_copy() {
        assert!(broadcast_ciphertext(true, Some(b"sender-copy")).is_empty());
        assert_eq!(
            broadcast_ciphertext(false, Some(b"group-message")),
            STANDARD.encode(b"group-message")
        );
    }

    #[test]
    fn authenticated_device_must_match_request_device() {
        let auth_device_id = Uuid::now_v7();
        let requested_device_id = Uuid::now_v7();

        let result = resolve_e2ee_sender_device(Some(auth_device_id), Some(requested_device_id));

        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn authenticated_device_is_used_when_request_omits_device() {
        let auth_device_id = Uuid::now_v7();

        let result = resolve_e2ee_sender_device(Some(auth_device_id), None).unwrap();

        assert_eq!(result, auth_device_id);
    }
}
