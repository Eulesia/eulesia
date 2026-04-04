use std::sync::Arc;
use std::time::Duration;

use sea_orm::DatabaseConnection;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use eulesia_db::repo::outbox::OutboxRepo;
use eulesia_db::repo::sessions::SessionRepo;
use eulesia_notify::dispatch::NotificationDispatcher;
use eulesia_notify::types::NotificationEvent;
use eulesia_search::sync::SearchSync;

const POLL_INTERVAL: Duration = Duration::from_secs(5);
const MAX_ATTEMPTS: i16 = 5;

/// Context passed to the outbox worker with optional integrations.
pub struct WorkerContext {
    pub db: Arc<DatabaseConnection>,
    pub dispatcher: Option<Arc<NotificationDispatcher>>,
    pub search_sync: Option<Arc<SearchSync>>,
}

pub async fn run(ctx: Arc<WorkerContext>, cancel: CancellationToken) {
    info!("outbox worker started");

    loop {
        tokio::select! {
            () = cancel.cancelled() => {
                info!("outbox worker shutting down");
                break;
            }
            () = tokio::time::sleep(POLL_INTERVAL) => {
                if let Err(e) = process_batch(&ctx).await {
                    error!(error = %e, "outbox worker batch failed");
                }
            }
        }
    }
}

async fn process_batch(ctx: &WorkerContext) -> Result<(), sea_orm::DbErr> {
    let events = OutboxRepo::fetch_pending(&ctx.db, 50).await?;
    if events.is_empty() {
        return Ok(());
    }

    info!(count = events.len(), "processing outbox events");

    for event in events {
        match process_event(ctx, &event).await {
            Ok(()) => {
                OutboxRepo::mark_completed(&ctx.db, event.id).await?;
            }
            Err(e) => {
                let msg = e.to_string();
                warn!(event_id = %event.id, error = %msg, "outbox event failed");
                if event.attempt_count >= MAX_ATTEMPTS {
                    warn!(event_id = %event.id, "event exceeded max attempts, moving to dead letter");
                    OutboxRepo::mark_dead(&ctx.db, event.id, &msg).await?;
                } else {
                    let backoff = backoff_seconds(event.attempt_count);
                    let next_at =
                        chrono::Utc::now().fixed_offset() + chrono::Duration::seconds(backoff);
                    OutboxRepo::mark_failed(&ctx.db, event.id, &msg, next_at).await?;
                }
            }
        }
    }
    Ok(())
}

async fn process_event(
    ctx: &WorkerContext,
    event: &eulesia_db::entities::outbox::Model,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match event.event_type.as_str() {
        "session_cleanup" => {
            let deleted = SessionRepo::cleanup_expired(&ctx.db).await?;
            if deleted > 0 {
                info!(deleted, "cleaned up expired sessions");
            }
            Ok(())
        }
        "notification" => {
            if let Some(ref dispatcher) = ctx.dispatcher {
                let notification =
                    serde_json::from_value::<NotificationEvent>(event.payload.clone())?;
                dispatcher.dispatch(&notification).await?;
            }
            Ok(())
        }
        // Search index sync events
        "thread_created" | "thread_updated" | "thread_deleted" | "user_created"
        | "user_updated" => {
            if let Some(ref sync) = ctx.search_sync {
                sync.process_event(event.event_type.as_str(), &event.payload)
                    .await?;
            }
            Ok(())
        }
        other => {
            warn!(event_type = other, "unknown outbox event type, skipping");
            Ok(())
        }
    }
}

fn backoff_seconds(attempt: i16) -> i64 {
    // Exponential backoff: 30s, 60s, 120s, 240s, 480s
    i64::from(30 * (1 << attempt.min(4)))
}
