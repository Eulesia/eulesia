use sea_orm::ActiveValue::Set;
use sea_orm::*;
use serde_json::Value;

use crate::entities::outbox;
use crate::repo::outbox::OutboxRepo;

/// Emit an outbox event for async processing by the outbox worker.
///
/// Accepts `&impl ConnectionTrait` so it can be called inside transactions.
pub async fn emit_event(
    db: &impl ConnectionTrait,
    event_type: &str,
    payload: Value,
) -> Result<(), DbErr> {
    let now = chrono::Utc::now().fixed_offset();
    let id = eulesia_common::types::new_id();
    OutboxRepo::create(
        db,
        outbox::ActiveModel {
            id: Set(id),
            event_type: Set(event_type.to_string()),
            payload: Set(payload),
            status: Set("pending".to_string()),
            attempt_count: Set(0),
            last_error: Set(None),
            available_at: Set(now),
            processed_at: Set(None),
            created_at: Set(now),
        },
    )
    .await?;
    Ok(())
}
