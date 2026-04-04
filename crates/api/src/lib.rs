mod agora;
mod auth_routes;
mod bookmarks;
mod devices;
mod health;
mod messaging;
mod moderation;
mod notifications;
mod search;
mod social;
mod users;

use std::ops::Deref;
use std::sync::Arc;

use axum::Router;
use axum::middleware::from_fn_with_state;
use sea_orm::DatabaseConnection;
use serde::Deserialize;

use eulesia_auth::middleware::auth_middleware;
use eulesia_search::client::SearchClient;
use eulesia_ws::registry::ConnectionRegistry;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<DatabaseConnection>,
    pub config: Arc<AppConfig>,
    pub search_client: Option<Arc<SearchClient>>,
    pub ws_registry: ConnectionRegistry,
}

impl Deref for AppState {
    type Target = DatabaseConnection;
    fn deref(&self) -> &Self::Target {
        &self.db
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub cookie_domain: Option<String>,
    pub cookie_secure: bool,
    pub session_max_age_days: u32,
    pub frontend_origin: String,
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .merge(health::routes())
        .merge(auth_routes::routes())
        .merge(devices::routes())
        .merge(users::routes())
        .merge(social::routes())
        .merge(bookmarks::routes())
        .merge(agora::routes())
        .merge(messaging::routes())
        .merge(moderation::routes())
        .merge(notifications::routes())
        .merge(search::routes())
        .layer(from_fn_with_state(state.db.clone(), auth_middleware));

    // WS route is outside the /api/v2 nest (no auth middleware -- handled in the handler)
    let ws_state = (state.db.clone(), state.ws_registry.clone());

    Router::new()
        .nest("/api/v2", api)
        .route(
            "/ws/v2",
            axum::routing::get(eulesia_ws::handler::ws_upgrade).with_state(ws_state),
        )
        .with_state(state)
}
