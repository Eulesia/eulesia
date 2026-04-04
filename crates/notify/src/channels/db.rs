use eulesia_db::entities::notifications;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseConnection};
use uuid::Uuid;

use crate::error::NotifyError;
use crate::types::NotificationEvent;

pub async fn send(db: &DatabaseConnection, event: &NotificationEvent) -> Result<(), NotifyError> {
    let now = chrono::Utc::now().fixed_offset();
    notifications::ActiveModel {
        id: Set(Uuid::now_v7()),
        user_id: Set(event.user_id),
        event_type: Set(event.event_type.clone()),
        title: Set(event.title.clone()),
        body: Set(event.body.clone()),
        link: Set(event.link.clone()),
        read: Set(false),
        created_at: Set(now),
    }
    .insert(db)
    .await
    .map_err(|source| NotifyError::Database {
        context: "persist notification",
        source,
    })?;
    Ok(())
}
