use meilisearch_sdk::client::Client;

pub struct SearchClient {
    client: Client,
}

impl SearchClient {
    /// # Panics
    ///
    /// Panics if the Meilisearch client cannot be created (e.g. invalid URL or API key).
    pub fn new(url: &str, api_key: Option<&str>) -> Self {
        let client = Client::new(url, api_key).expect("failed to create Meilisearch client");
        Self { client }
    }

    pub const fn inner(&self) -> &Client {
        &self.client
    }

    pub async fn is_healthy(&self) -> bool {
        self.client.is_healthy().await
    }
}
