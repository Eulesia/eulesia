use std::sync::Arc;

use sea_orm::DatabaseConnection;
use tracing::{info, warn};

use crate::channels;
use crate::types::NotificationEvent;
use eulesia_db::repo::devices::DeviceRepo;
use eulesia_db::repo::push_subscriptions::PushSubscriptionRepo;

pub struct NotificationDispatcher {
    db: Arc<DatabaseConnection>,
    fcm: channels::fcm::FcmClient,
    webpush: channels::webpush::WebPushClient,
}

impl NotificationDispatcher {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self {
            db,
            fcm: channels::fcm::FcmClient::new(),
            webpush: channels::webpush::WebPushClient::new(),
        }
    }

    pub async fn dispatch(
        &self,
        event: &NotificationEvent,
    ) -> Result<(), crate::error::NotifyError> {
        // Channel 1: DB (persistent notification record) — must succeed for
        // the notification to be considered delivered.
        channels::db::send(&self.db, event).await?;

        // Channel 2: FCM (push to native devices) — best-effort
        match DeviceRepo::list_active_for_user(&*self.db, event.user_id).await {
            Ok(devs) => {
                for dev in devs {
                    if let Some(ref token) = dev.fcm_token {
                        self.fcm
                            .send(token, &event.title, event.body.as_deref().unwrap_or(""))
                            .await;
                    }
                }
            }
            Err(e) => warn!(error = %e, "failed to fetch devices for FCM delivery"),
        }

        // Channel 3: Web Push (browser push) — best-effort
        let payload = match serde_json::to_string(event) {
            Ok(p) => p,
            Err(e) => {
                warn!(error = %e, "failed to serialize notification payload");
                return Ok(());
            }
        };
        match PushSubscriptionRepo::list_for_user(&*self.db, event.user_id).await {
            Ok(subscriptions) => {
                for sub in subscriptions {
                    self.webpush
                        .send(&sub.endpoint, &sub.p256dh, &sub.auth, &payload)
                        .await;
                }
            }
            Err(e) => warn!(error = %e, "failed to fetch push subscriptions for web push delivery"),
        }

        info!(user_id = %event.user_id, event_type = %event.event_type, "notification dispatched");
        Ok(())
    }
}
