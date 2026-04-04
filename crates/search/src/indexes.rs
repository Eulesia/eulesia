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
    if let Err(e) = threads
        .set_filterable_attributes(["scope", "municipality_id", "tags", "author_id"])
        .await
    {
        tracing::warn!(error = %e, "failed to set filterable attributes on threads index");
    }
    if let Err(e) = threads
        .set_sortable_attributes(["score", "created_at"])
        .await
    {
        tracing::warn!(error = %e, "failed to set sortable attributes on threads index");
    }
    if let Err(e) = threads
        .set_searchable_attributes(["title", "content", "tags"])
        .await
    {
        tracing::warn!(error = %e, "failed to set searchable attributes on threads index");
    }

    // Users index
    let users = client.index("users");
    if let Err(e) = users.set_searchable_attributes(["username", "name"]).await {
        tracing::warn!(error = %e, "failed to set searchable attributes on users index");
    }
    if let Err(e) = users.set_filterable_attributes(["role"]).await {
        tracing::warn!(error = %e, "failed to set filterable attributes on users index");
    }

    info!("Meilisearch indexes configured");
}
