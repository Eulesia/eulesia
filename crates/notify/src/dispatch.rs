use std::sync::Arc;

use sea_orm::DatabaseConnection;
use tracing::{error, info};

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

    pub async fn dispatch(&self, event: &NotificationEvent) {
        // Channel 1: DB (persistent notification record)
        if let Err(e) = channels::db::send(&self.db, event).await {
            error!(error = %e, "failed to persist notification");
        }

        // Channel 2: FCM (push to native devices)
        let devices = DeviceRepo::list_active_for_user(&*self.db, event.user_id).await;
        if let Ok(devs) = devices {
            for dev in devs {
                if let Some(ref token) = dev.fcm_token {
                    self.fcm
                        .send(token, &event.title, event.body.as_deref().unwrap_or(""))
                        .await;
                }
            }
        }

        // Channel 3: Web Push (browser push)
        let subs = PushSubscriptionRepo::list_for_user(&*self.db, event.user_id).await;
        if let Ok(subscriptions) = subs {
            let payload = serde_json::to_string(event).unwrap_or_default();
            for sub in subscriptions {
                self.webpush
                    .send(&sub.endpoint, &sub.p256dh, &sub.auth, &payload)
                    .await;
            }
        }

        info!(user_id = %event.user_id, event_type = %event.event_type, "notification dispatched");
    }
}
