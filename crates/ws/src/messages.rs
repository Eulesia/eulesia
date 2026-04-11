use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "new_message")]
    NewMessage {
        conversation_id: Uuid,
        message_id: Uuid,
        sender_id: Uuid,
        /// Base64-encoded ciphertext when it is identical for all recipients.
        /// Per-device messages use an empty string; clients must refetch.
        ciphertext: String,
        epoch: i64,
    },
    #[serde(rename = "notification")]
    Notification {
        id: Uuid,
        event_type: String,
        title: String,
        body: Option<String>,
        link: Option<String>,
    },
    #[serde(rename = "typing")]
    Typing {
        conversation_id: Uuid,
        user_id: Uuid,
        is_typing: bool,
    },
    #[serde(rename = "presence")]
    Presence { user_id: Uuid, online: bool },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "typing_start")]
    TypingStart { conversation_id: Uuid },
    #[serde(rename = "typing_stop")]
    TypingStop { conversation_id: Uuid },
    #[serde(rename = "ping")]
    Ping,
}
