use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use serde::{Deserialize, Serialize};

use eulesia_common::error::ApiError;

use crate::AppState;

#[derive(Deserialize)]
struct SearchParams {
    q: String,
    r#type: Option<String>, // "threads" | "users"
    limit: Option<usize>,
}

#[derive(Serialize)]
struct SearchResult {
    threads: Vec<serde_json::Value>,
    users: Vec<serde_json::Value>,
}

async fn search_handler(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResult>, ApiError> {
    let limit = params.limit.unwrap_or(20).min(100);
    let search_client = state.search_client.as_ref();

    let mut result = SearchResult {
        threads: vec![],
        users: vec![],
    };

    if let Some(client) = search_client {
        let search_type = params.r#type.as_deref();
        if search_type.is_none() || search_type == Some("threads") {
            let threads_index = client.inner().index("threads");
            if let Ok(search_result) = threads_index
                .search()
                .with_query(&params.q)
                .with_limit(limit)
                .execute::<serde_json::Value>()
                .await
            {
                result.threads = search_result.hits.into_iter().map(|h| h.result).collect();
            }
        }
        if search_type.is_none() || search_type == Some("users") {
            let users_index = client.inner().index("users");
            if let Ok(search_result) = users_index
                .search()
                .with_query(&params.q)
                .with_limit(limit)
                .execute::<serde_json::Value>()
                .await
            {
                result.users = search_result.hits.into_iter().map(|h| h.result).collect();
            }
        }
    }

    Ok(Json(result))
}

async fn search_health(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let healthy = if let Some(client) = state.search_client.as_ref() {
        client.is_healthy().await
    } else {
        false
    };
    Ok(Json(serde_json::json!({ "healthy": healthy })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/search", get(search_handler))
        .route("/search/health", get(search_health))
}
