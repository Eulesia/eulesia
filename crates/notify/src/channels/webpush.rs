use tracing::info;

pub struct WebPushClient;

impl Default for WebPushClient {
    fn default() -> Self {
        Self::new()
    }
}

impl WebPushClient {
    pub const fn new() -> Self {
        Self
    }

    #[allow(clippy::unused_async)]
    pub async fn send(&self, endpoint: &str, _p256dh: &str, _auth: &str, _payload: &str) {
        // TODO: Implement VAPID Web Push with ECDH encryption
        info!(endpoint, "Web Push notification would be sent");
    }
}
