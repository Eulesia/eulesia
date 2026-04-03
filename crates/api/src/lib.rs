mod health;
mod users;

use std::ops::Deref;
use std::sync::Arc;

use axum::Router;
use sea_orm::DatabaseConnection;

/// Application state shared across all handlers.
///
/// `DatabaseConnection` does not implement `Clone`, so we wrap it in `Arc`.
/// `Deref` lets handlers use `state.db` directly without `.as_ref()`.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<DatabaseConnection>,
}

impl Deref for AppState {
    type Target = DatabaseConnection;
    fn deref(&self) -> &Self::Target {
        &self.db
    }
}

/// Create the full API router.
pub fn router(state: AppState) -> Router {
    let api = Router::new().merge(health::routes()).merge(users::routes());

    Router::new().nest("/api/v2", api).with_state(state)
}
