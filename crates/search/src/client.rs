use meilisearch_sdk::client::Client;

pub struct SearchClient {
    client: Client,
}

impl SearchClient {
    pub fn new(url: &str, api_key: Option<&str>) -> Result<Self, String> {
        let client = Client::new(url, api_key)
            .map_err(|e| format!("failed to create Meilisearch client: {e}"))?;
        Ok(Self { client })
    }

    pub const fn inner(&self) -> &Client {
        &self.client
    }

    pub async fn is_healthy(&self) -> bool {
        self.client.is_healthy().await
    }
}
