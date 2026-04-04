use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationEvent {
    pub user_id: Uuid,
    pub event_type: String,
    pub title: String,
    pub body: Option<String>,
    pub link: Option<String>,
}
