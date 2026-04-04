use axum::Json;
use axum::extract::{Path, State};
use sea_orm::ActiveModelTrait;
use sea_orm::ActiveValue::Set;
use sea_orm::TransactionTrait;
use uuid::Uuid;

use crate::AppState;
use eulesia_auth::session::AuthUser;
use eulesia_common::error::ApiError;
use eulesia_common::types::{ConversationType, GroupRole, new_id};
use eulesia_db::entities::{
    conversation_epochs, conversations, direct_conversations, membership_events, memberships,
};
use eulesia_db::repo::conversations::ConversationRepo;
use eulesia_db::repo::epochs::EpochRepo;
use eulesia_db::repo::memberships::MembershipRepo;
use eulesia_db::repo::users::UserRepo;

use super::types::{
    ConversationListItem, ConversationResponse, CreateConversationRequest, EpochResponse,
    MemberSummary, UpdateConversationRequest,
};

#[allow(clippy::needless_pass_by_value)]
fn db_err(e: sea_orm::DbErr) -> ApiError {
    ApiError::Database(e.to_string())
}

fn members_from_models(models: &[memberships::Model]) -> Vec<MemberSummary> {
    models
        .iter()
        .map(|m| MemberSummary {
            user_id: m.user_id,
            role: m.role.parse::<GroupRole>().unwrap_or(GroupRole::Member),
            joined_epoch: m.joined_epoch,
        })
        .collect()
}

fn conversation_response(
    conv: &conversations::Model,
    members: Vec<MemberSummary>,
) -> ConversationResponse {
    ConversationResponse {
        id: conv.id,
        conversation_type: conv.r#type.clone(),
        encryption: conv.encryption.clone(),
        name: conv.name.clone(),
        description: conv.description.clone(),
        creator_id: conv.creator_id,
        current_epoch: conv.current_epoch,
        members,
        created_at: conv.created_at.to_rfc3339(),
        updated_at: conv.updated_at.to_rfc3339(),
    }
}

// ---------------------------------------------------------------------------
// POST /conversations
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_lines)]
pub async fn create(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateConversationRequest>,
) -> Result<Json<ConversationResponse>, ApiError> {
    let caller = auth.user_id.0;

    match req.conversation_type {
        ConversationType::Direct => create_direct(caller, &state, &req).await,
        ConversationType::Group => create_group(caller, &state, &req).await,
        ConversationType::Channel => Err(ApiError::BadRequest(
            "channel conversations are not yet supported".into(),
        )),
    }
}

#[allow(clippy::too_many_lines)]
async fn create_direct(
    caller: Uuid,
    state: &AppState,
    req: &CreateConversationRequest,
) -> Result<Json<ConversationResponse>, ApiError> {
    if req.members.len() != 1 {
        return Err(ApiError::BadRequest(
            "direct conversations require exactly 1 member".into(),
        ));
    }

    let other = req.members[0];

    // Cannot DM yourself.
    if caller == other {
        return Err(ApiError::BadRequest(
            "cannot create a direct conversation with yourself".into(),
        ));
    }

    // Verify the other user exists.
    UserRepo::find_by_id(&state.db, other)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("target user not found".into()))?;

    // Check for existing DM (find_direct does not filter deleted_at).
    if let Some(existing) = ConversationRepo::find_direct(&state.db, caller, other)
        .await
        .map_err(db_err)?
    {
        // Skip soft-deleted conversations — fall through to create a new one.
        if existing.deleted_at.is_none() {
            // Verify both users still have active memberships. If not, reactivate.
            let members = ConversationRepo::active_members(&state.db, existing.id)
                .await
                .map_err(db_err)?;
            let caller_active = members.iter().any(|m| m.user_id == caller);
            let other_active = members.iter().any(|m| m.user_id == other);

            if caller_active && other_active {
                return Ok(Json(conversation_response(
                    &existing,
                    members_from_models(&members),
                )));
            }

            // Reactivate: re-add missing members and bump epoch.
            let txn = state
                .db
                .begin()
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;
            let new_epoch = EpochRepo::increment(&txn, existing.id)
                .await
                .map_err(db_err)?;
            let now = chrono::Utc::now().fixed_offset();

            for &uid in &[caller, other] {
                if !members.iter().any(|m| m.user_id == uid) {
                    MembershipRepo::create(
                        &txn,
                        eulesia_db::entities::memberships::ActiveModel {
                            id: Set(new_id()),
                            conversation_id: Set(existing.id),
                            user_id: Set(uid),
                            role: Set(GroupRole::Member.as_str().into()),
                            joined_epoch: Set(new_epoch),
                            left_at: Set(None),
                            removed_by: Set(None),
                            created_at: Set(now),
                        },
                    )
                    .await
                    .map_err(db_err)?;
                }
            }

            EpochRepo::create(
                &txn,
                eulesia_db::entities::conversation_epochs::ActiveModel {
                    conversation_id: Set(existing.id),
                    epoch: Set(new_epoch),
                    rotated_by: Set(Some(caller)),
                    reason: Set("member_added".into()),
                    created_at: Set(now),
                },
            )
            .await
            .map_err(db_err)?;

            txn.commit()
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

            // Re-fetch conversation to get updated epoch and timestamps.
            let refreshed_conv = ConversationRepo::find_by_id(&state.db, existing.id)
                .await
                .map_err(db_err)?
                .ok_or_else(|| ApiError::NotFound("conversation not found".into()))?;
            let refreshed_members = ConversationRepo::active_members(&state.db, existing.id)
                .await
                .map_err(db_err)?;
            return Ok(Json(conversation_response(
                &refreshed_conv,
                members_from_models(&refreshed_members),
            )));
        }
    }

    let conv_id = new_id();
    let now = chrono::Utc::now().fixed_offset();
    let (user_a, user_b) = if caller < other {
        (caller, other)
    } else {
        (other, caller)
    };

    let txn = state
        .db
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create conversation.
    let conv = conversations::ActiveModel {
        id: Set(conv_id),
        r#type: Set("direct".into()),
        encryption: Set("e2ee".into()),
        name: Set(None),
        description: Set(None),
        avatar_url: Set(None),
        creator_id: Set(None),
        is_public: Set(false),
        current_epoch: Set(0),
        deleted_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&txn)
    .await
    .map_err(db_err)?;

    // Direct conversations index.
    direct_conversations::ActiveModel {
        conversation_id: Set(conv_id),
        user_a_id: Set(user_a),
        user_b_id: Set(user_b),
    }
    .insert(&txn)
    .await
    .map_err(db_err)?;

    // Memberships for both users.
    for user_id in [caller, other] {
        let mem_id = new_id();
        MembershipRepo::create(
            &txn,
            memberships::ActiveModel {
                id: Set(mem_id),
                conversation_id: Set(conv_id),
                user_id: Set(user_id),
                role: Set(GroupRole::Member.as_str().into()),
                joined_epoch: Set(0),
                left_at: Set(None),
                removed_by: Set(None),
                created_at: Set(now),
            },
        )
        .await
        .map_err(db_err)?;

        MembershipRepo::create_event(
            &txn,
            membership_events::ActiveModel {
                id: Set(new_id()),
                conversation_id: Set(conv_id),
                user_id: Set(user_id),
                event_type: Set("joined".into()),
                epoch: Set(0),
                actor_id: Set(Some(caller)),
                metadata: Set(None),
                created_at: Set(now),
            },
        )
        .await
        .map_err(db_err)?;
    }

    // Initial epoch record.
    EpochRepo::create(
        &txn,
        conversation_epochs::ActiveModel {
            conversation_id: Set(conv_id),
            epoch: Set(0),
            rotated_by: Set(Some(caller)),
            reason: Set("created".into()),
            created_at: Set(now),
        },
    )
    .await
    .map_err(db_err)?;

    match txn.commit().await {
        Ok(()) => {}
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("unique") || msg.contains("duplicate") {
                // Race condition: another request created the same DM.
                // Fetch and return the existing conversation.
                if let Some(existing) = ConversationRepo::find_direct(&state.db, caller, other)
                    .await
                    .map_err(db_err)?
                {
                    let members = ConversationRepo::active_members(&state.db, existing.id)
                        .await
                        .map_err(db_err)?;
                    return Ok(Json(conversation_response(
                        &existing,
                        members_from_models(&members),
                    )));
                }
            }
            return Err(ApiError::Database(msg));
        }
    }

    let members = ConversationRepo::active_members(&state.db, conv_id)
        .await
        .map_err(db_err)?;

    Ok(Json(conversation_response(
        &conv,
        members_from_models(&members),
    )))
}

#[allow(clippy::too_many_lines)]
async fn create_group(
    caller: Uuid,
    state: &AppState,
    req: &CreateConversationRequest,
) -> Result<Json<ConversationResponse>, ApiError> {
    let conv_id = new_id();
    let now = chrono::Utc::now().fixed_offset();

    let txn = state
        .db
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let conv = conversations::ActiveModel {
        id: Set(conv_id),
        r#type: Set("group".into()),
        encryption: Set("e2ee".into()),
        name: Set(req.name.clone()),
        description: Set(req.description.clone()),
        avatar_url: Set(None),
        creator_id: Set(Some(caller)),
        is_public: Set(false),
        current_epoch: Set(0),
        deleted_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&txn)
    .await
    .map_err(db_err)?;

    // Creator membership (admin).
    MembershipRepo::create(
        &txn,
        memberships::ActiveModel {
            id: Set(new_id()),
            conversation_id: Set(conv_id),
            user_id: Set(caller),
            role: Set(GroupRole::Owner.as_str().into()),
            joined_epoch: Set(0),
            left_at: Set(None),
            removed_by: Set(None),
            created_at: Set(now),
        },
    )
    .await
    .map_err(db_err)?;

    MembershipRepo::create_event(
        &txn,
        membership_events::ActiveModel {
            id: Set(new_id()),
            conversation_id: Set(conv_id),
            user_id: Set(caller),
            event_type: Set("joined".into()),
            epoch: Set(0),
            actor_id: Set(Some(caller)),
            metadata: Set(None),
            created_at: Set(now),
        },
    )
    .await
    .map_err(db_err)?;

    // Initial epoch record.
    EpochRepo::create(
        &txn,
        conversation_epochs::ActiveModel {
            conversation_id: Set(conv_id),
            epoch: Set(0),
            rotated_by: Set(Some(caller)),
            reason: Set("created".into()),
            created_at: Set(now),
        },
    )
    .await
    .map_err(db_err)?;

    // Invite initial members — deduplicate and exclude the creator.
    let unique_members: std::collections::BTreeSet<Uuid> = req
        .members
        .iter()
        .copied()
        .filter(|&id| id != caller)
        .collect();

    for member_id in unique_members {
        // Verify user exists.
        UserRepo::find_by_id(&state.db, member_id)
            .await
            .map_err(db_err)?
            .ok_or_else(|| ApiError::NotFound(format!("user {member_id} not found")))?;

        MembershipRepo::create(
            &txn,
            memberships::ActiveModel {
                id: Set(new_id()),
                conversation_id: Set(conv_id),
                user_id: Set(member_id),
                role: Set(GroupRole::Member.as_str().into()),
                joined_epoch: Set(0),
                left_at: Set(None),
                removed_by: Set(None),
                created_at: Set(now),
            },
        )
        .await
        .map_err(db_err)?;

        MembershipRepo::create_event(
            &txn,
            membership_events::ActiveModel {
                id: Set(new_id()),
                conversation_id: Set(conv_id),
                user_id: Set(member_id),
                event_type: Set("invited".into()),
                epoch: Set(0),
                actor_id: Set(Some(caller)),
                metadata: Set(None),
                created_at: Set(now),
            },
        )
        .await
        .map_err(db_err)?;
    }

    txn.commit()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let members = ConversationRepo::active_members(&state.db, conv_id)
        .await
        .map_err(db_err)?;

    Ok(Json(conversation_response(
        &conv,
        members_from_models(&members),
    )))
}

// ---------------------------------------------------------------------------
// GET /conversations
// ---------------------------------------------------------------------------

pub async fn list(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<ConversationListItem>>, ApiError> {
    let memberships = ConversationRepo::user_conversations(&state.db, auth.user_id.0)
        .await
        .map_err(db_err)?;

    let conv_ids: Vec<uuid::Uuid> = memberships.iter().map(|m| m.conversation_id).collect();
    let conversations = ConversationRepo::find_by_ids(&state.db, &conv_ids)
        .await
        .map_err(db_err)?;

    let items = conversations
        .into_iter()
        .map(|conv| ConversationListItem {
            id: conv.id,
            conversation_type: conv.r#type,
            name: conv.name,
            current_epoch: conv.current_epoch,
            created_at: conv.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(items))
}

// ---------------------------------------------------------------------------
// GET /conversations/{id}
// ---------------------------------------------------------------------------

pub async fn get(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ConversationResponse>, ApiError> {
    let conv = ConversationRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("conversation not found".into()))?;

    // Verify caller is an active member.
    MembershipRepo::find_active(&*state.db, id, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Forbidden)?;

    let members = ConversationRepo::active_members(&state.db, id)
        .await
        .map_err(db_err)?;

    Ok(Json(conversation_response(
        &conv,
        members_from_models(&members),
    )))
}

// ---------------------------------------------------------------------------
// PATCH /conversations/{id}
// ---------------------------------------------------------------------------

pub async fn update(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateConversationRequest>,
) -> Result<Json<ConversationResponse>, ApiError> {
    let conv = ConversationRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("conversation not found".into()))?;

    let conv_type = conv
        .r#type
        .parse::<ConversationType>()
        .map_err(ApiError::Internal)?;

    if conv_type != ConversationType::Group {
        return Err(ApiError::BadRequest(
            "only group conversations can be updated".into(),
        ));
    }

    // Verify caller is admin.
    let membership = MembershipRepo::find_active(&*state.db, id, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Forbidden)?;

    let caller_role: GroupRole = membership
        .role
        .parse()
        .map_err(|e: String| ApiError::Internal(e))?;

    if !caller_role.is_owner() {
        return Err(ApiError::Forbidden);
    }

    let now = chrono::Utc::now().fixed_offset();
    let mut am = conversations::ActiveModel {
        id: Set(id),
        updated_at: Set(now),
        ..Default::default()
    };

    if let Some(name) = req.name {
        am.name = Set(Some(name));
    }
    if let Some(description) = req.description {
        am.description = Set(Some(description));
    }

    let updated: conversations::Model = am.update(&*state.db).await.map_err(db_err)?;

    let members = ConversationRepo::active_members(&state.db, id)
        .await
        .map_err(db_err)?;

    Ok(Json(conversation_response(
        &updated,
        members_from_models(&members),
    )))
}

// ---------------------------------------------------------------------------
// DELETE /conversations/{id}
// ---------------------------------------------------------------------------

pub async fn delete_conversation(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<(), ApiError> {
    let conv = ConversationRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("conversation not found".into()))?;

    let membership = MembershipRepo::find_active(&*state.db, id, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Forbidden)?;

    let is_creator = conv.creator_id == Some(auth.user_id.0);
    let caller_role: GroupRole = membership
        .role
        .parse()
        .map_err(|e: String| ApiError::Internal(e))?;
    let is_admin = caller_role.is_owner();

    if !is_creator && !is_admin {
        return Err(ApiError::Forbidden);
    }

    // Soft delete.
    let now = chrono::Utc::now().fixed_offset();
    let am = conversations::ActiveModel {
        id: Set(id),
        deleted_at: Set(Some(now)),
        updated_at: Set(now),
        ..Default::default()
    };
    am.update(&*state.db).await.map_err(db_err)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// GET /conversations/{id}/epochs
// ---------------------------------------------------------------------------

pub async fn list_epochs(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<EpochResponse>>, ApiError> {
    // Verify conversation exists.
    ConversationRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("conversation not found".into()))?;

    // Verify caller is an active member.
    MembershipRepo::find_active(&*state.db, id, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Forbidden)?;

    let epochs = EpochRepo::list_for_conversation(&*state.db, id)
        .await
        .map_err(db_err)?;

    let items = epochs
        .into_iter()
        .map(|e| EpochResponse {
            epoch: e.epoch,
            rotated_by: e.rotated_by,
            reason: e.reason,
            created_at: e.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(items))
}
