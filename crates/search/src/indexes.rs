use meilisearch_sdk::client::Client;
use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Debug, Serialize, Deserialize)]
pub struct ThreadDocument {
    pub id: String,
    pub title: String,
    pub content: String,
    pub author_id: String,
    pub author_name: String,
    pub scope: String,
    pub municipality_id: Option<String>,
    pub tags: Vec<String>,
    pub score: i32,
    pub created_at: i64, // unix timestamp for sortable
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserDocument {
    pub id: String,
    pub username: String,
    pub name: String,
    pub role: String,
    pub avatar_url: Option<String>,
}

pub async fn ensure_indexes(client: &Client) {
    // Threads index
    let threads = client.index("threads");
    let _ = threads
        .set_filterable_attributes(["scope", "municipality_id", "tags", "author_id"])
        .await;
    let _ = threads
        .set_sortable_attributes(["score", "created_at"])
        .await;
    let _ = threads
        .set_searchable_attributes(["title", "content", "tags"])
        .await;

    // Users index
    let users = client.index("users");
    let _ = users.set_searchable_attributes(["username", "name"]).await;
    let _ = users.set_filterable_attributes(["role"]).await;

    info!("Meilisearch indexes configured");
}
