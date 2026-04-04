use reqwest::Client;
use tracing::info;

pub struct FcmClient {
    #[allow(dead_code)]
    client: Client,
}

impl Default for FcmClient {
    fn default() -> Self {
        Self::new()
    }
}

impl FcmClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    #[allow(clippy::unused_async)]
    pub async fn send(&self, device_token: &str, title: &str, _body: &str) {
        // TODO: Implement FCM HTTP v1 POST with Google service account JWT auth
        info!(
            token = device_token,
            title, "FCM notification would be sent"
        );
    }
}
