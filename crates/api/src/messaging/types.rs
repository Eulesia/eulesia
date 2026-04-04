use std::collections::HashMap;

use base64::{Engine, engine::general_purpose::STANDARD};
use eulesia_common::types::{ConversationType, GroupRole, MessageType};
use eulesia_db::entities::messages;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateConversationRequest {
    pub conversation_type: ConversationType,
    pub name: Option<String>,
    pub description: Option<String>,
    pub members: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateConversationRequest {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub message_type: MessageType,
    pub ciphertext: Option<String>,
    pub device_ciphertexts: Option<HashMap<Uuid, String>>,
}

#[derive(Debug, Deserialize)]
pub struct InviteMemberRequest {
    pub user_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoleRequest {
    pub role: GroupRole,
}

#[derive(Debug, Deserialize)]
pub struct AcknowledgeRequest {
    pub deliveries: Vec<DeliveryAck>,
}

#[derive(Debug, Deserialize)]
pub struct DeliveryAck {
    pub message_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct MessageCursorParams {
    pub before: Option<Uuid>,
    pub limit: Option<u64>,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
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
pub struct ConversationListItem {
    pub id: Uuid,
    pub conversation_type: String,
    pub name: Option<String>,
    pub current_epoch: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct MemberSummary {
    pub user_id: Uuid,
    pub role: GroupRole,
    pub joined_epoch: i64,
}

#[derive(Debug, Serialize)]
pub struct MessageResponse {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub sender_id: Uuid,
    pub sender_device_id: Uuid,
    pub epoch: i64,
    pub ciphertext: String,
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
            ciphertext: STANDARD.encode(&m.ciphertext),
            message_type: m.message_type.clone(),
            server_ts: m.server_ts.to_rfc3339(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct PendingDelivery {
    pub message_id: Uuid,
    pub ciphertext: String,
    pub enqueued_at: String,
}

#[derive(Debug, Serialize)]
pub struct EpochResponse {
    pub epoch: i64,
    pub rotated_by: Option<Uuid>,
    pub reason: String,
    pub created_at: String,
}
