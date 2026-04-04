use meilisearch_sdk::client::Client;
use serde_json::Value;
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum SearchError {
    #[error("meilisearch error: {0}")]
    Meilisearch(String),
}

pub struct SearchSync {
    client: Client,
}

impl SearchSync {
    pub const fn new(client: Client) -> Self {
        Self { client }
    }

    pub async fn process_event(
        &self,
        event_type: &str,
        payload: &Value,
    ) -> Result<(), SearchError> {
        match event_type {
            "thread_created" | "thread_updated" => {
                let index = self.client.index("threads");
                index
                    .add_or_replace(&[payload], Some("id"))
                    .await
                    .map_err(|e| SearchError::Meilisearch(e.to_string()))?;
                info!("indexed thread");
                Ok(())
            }
            "thread_deleted" => {
                if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
                    let index = self.client.index("threads");
                    index
                        .delete_document(id)
                        .await
                        .map_err(|e| SearchError::Meilisearch(e.to_string()))?;
                    info!(id, "removed thread from index");
                }
                Ok(())
            }
            "user_created" | "user_updated" => {
                let index = self.client.index("users");
                index
                    .add_or_replace(&[payload], Some("id"))
                    .await
                    .map_err(|e| SearchError::Meilisearch(e.to_string()))?;
                info!("indexed user");
                Ok(())
            }
            _ => {
                // Unknown event -- skip silently
                Ok(())
            }
        }
    }
}
