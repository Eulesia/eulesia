use std::collections::HashMap;

use base64::{Engine, engine::general_purpose::STANDARD};
use eulesia_common::types::{ConversationType, GroupRole, MessageType};
use eulesia_db::entities::messages;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Maximum number of members in a group conversation (including creator).
pub const MAX_GROUP_MEMBERS: usize = 50;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationRequest {
    pub conversation_type: ConversationType,
    /// Encryption mode: "e2ee" (default) or "none" (plaintext).
    pub encryption: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub members: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConversationRequest {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    #[serde(default = "MessageType::default")]
    pub message_type: MessageType,
    /// E2EE: base64-encoded ciphertext (group/channel messages).
    pub ciphertext: Option<String>,
    /// E2EE: per-device ciphertexts (direct messages and hidden Matrix
    /// to-device protocol messages in group conversations).
    pub device_ciphertexts: Option<HashMap<Uuid, String>>,
    /// Plaintext content (for encryption: "none" conversations).
    pub content: Option<String>,
    /// The sender's device ID (required for E2EE sends from browser sessions
    /// that don't carry device_id in the auth token).
    pub sender_device_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteMemberRequest {
    pub user_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoleRequest {
    pub role: GroupRole,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcknowledgeRequest {
    pub deliveries: Vec<DeliveryAck>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryAck {
    pub message_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageCursorParams {
    pub before: Option<Uuid>,
    pub limit: Option<u64>,
    pub message_type: Option<MessageType>,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ConversationResponse {
    pub id: Uuid,
    pub conversation_type: String,
    pub encryption: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub creator_id: Option<Uuid>,
    pub current_epoch: i64,
    pub members: Vec<MemberSummary>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ConversationListItem {
    pub id: Uuid,
    pub conversation_type: String,
    pub name: Option<String>,
    pub current_epoch: i64,
    pub other_user: Option<ConversationUserSummary>,
    pub last_message: Option<LastMessageSummary>,
    pub unread_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ConversationUserSummary {
    pub id: Uuid,
    pub name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct LastMessageSummary {
    pub id: Uuid,
    pub content: Option<String>,
    pub sender_id: Uuid,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct MemberSummary {
    pub user_id: Uuid,
    pub name: String,
    pub avatar_url: Option<String>,
    pub role: GroupRole,
    pub joined_epoch: i64,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct MessageResponse {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub sender_id: Uuid,
    pub sender_device_id: Option<Uuid>,
    pub epoch: i64,
    /// Base64-encoded ciphertext (E2EE) or empty string (plaintext).
    pub ciphertext: String,
    /// Plaintext content (only set for encryption: "none" conversations).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub message_type: String,
    pub server_ts: String,
}

impl MessageResponse {
    /// Build a response from a DB model, encoding ciphertext as base64.
    pub fn from_model(m: &messages::Model) -> Self {
        Self {
            id: m.id,
            conversation_id: m.conversation_id,
            sender_id: m.sender_id,
            sender_device_id: m.sender_device_id,
            epoch: m.epoch,
            ciphertext: m
                .ciphertext
                .as_ref()
                .map(|ct| STANDARD.encode(ct))
                .unwrap_or_default(),
            content: None,
            message_type: m.message_type.clone(),
            server_ts: m.server_ts.to_rfc3339(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDelivery {
    pub message_id: Uuid,
    pub ciphertext: String,
    pub enqueued_at: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct EpochResponse {
    pub epoch: i64,
    pub rotated_by: Option<Uuid>,
    pub reason: String,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Contract test: ConversationListItem has the enrichment fields
    /// the frontend MessagesPage needs for DM list rendering.
    #[test]
    fn conversation_list_item_matches_frontend_contract() {
        let item = ConversationListItem {
            id: Uuid::nil(),
            conversation_type: "direct".into(),
            name: None,
            current_epoch: 0,
            other_user: Some(ConversationUserSummary {
                id: Uuid::nil(),
                name: "Alice".into(),
                avatar_url: Some("https://example.com/a.png".into()),
            }),
            last_message: Some(LastMessageSummary {
                id: Uuid::nil(),
                content: Some("Hello!".into()),
                sender_id: Uuid::nil(),
                created_at: "2026-01-01T00:00:00+00:00".into(),
            }),
            unread_count: 3,
            created_at: "2026-01-01T00:00:00+00:00".into(),
            updated_at: "2026-01-02T00:00:00+00:00".into(),
        };

        let json = serde_json::to_value(&item).unwrap();
        let obj = json.as_object().unwrap();

        let required_keys = [
            "id",
            "conversationType",
            "currentEpoch",
            "otherUser",
            "lastMessage",
            "unreadCount",
            "createdAt",
            "updatedAt",
        ];
        for key in &required_keys {
            assert!(obj.contains_key(*key), "missing field: {key}");
        }

        // otherUser shape
        let other = obj["otherUser"].as_object().unwrap();
        for key in &["id", "name", "avatarUrl"] {
            assert!(other.contains_key(*key), "missing otherUser.{key}");
        }

        // lastMessage shape
        let msg = obj["lastMessage"].as_object().unwrap();
        for key in &["id", "content", "senderId", "createdAt"] {
            assert!(msg.contains_key(*key), "missing lastMessage.{key}");
        }

        assert_eq!(obj["unreadCount"], 3);
        assert_eq!(obj["updatedAt"], "2026-01-02T00:00:00+00:00");
    }

    /// Verify null otherUser/lastMessage serialise correctly for group convos.
    #[test]
    fn conversation_list_item_group_has_null_other_user() {
        let item = ConversationListItem {
            id: Uuid::nil(),
            conversation_type: "group".into(),
            name: Some("Test Group".into()),
            current_epoch: 0,
            other_user: None,
            last_message: None,
            unread_count: 0,
            created_at: "2026-01-01T00:00:00+00:00".into(),
            updated_at: "2026-01-01T00:00:00+00:00".into(),
        };

        let json = serde_json::to_value(&item).unwrap();
        let obj = json.as_object().unwrap();

        assert!(obj["otherUser"].is_null());
        assert!(obj["lastMessage"].is_null());
        assert_eq!(obj["name"], "Test Group");
    }
}
