mod appeals;
mod reports;
mod sanctions;
mod types;

use axum::Router;
use axum::routing::{get, patch, post};
use sea_orm::DatabaseConnection;
use uuid::Uuid;

use crate::AppState;
use eulesia_common::error::ApiError;
use eulesia_common::types::UserRole;
use eulesia_db::repo::users::UserRepo;

/// Check that the given user has the `Moderator` role.
async fn require_moderator(db: &DatabaseConnection, user_id: Uuid) -> Result<(), ApiError> {
    let user = UserRepo::find_by_id(db, user_id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or(ApiError::Unauthorized)?;

    let role: UserRole = user
        .role
        .parse()
        .map_err(|e: String| ApiError::Internal(e))?;

    if !role.is_moderator() {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        // Reports — POST is open to all authenticated users.
        .route(
            "/moderation/reports",
            post(reports::create_report).get(reports::list_reports),
        )
        .route(
            "/moderation/reports/{id}",
            get(reports::get_report).patch(reports::update_report),
        )
        // Sanctions — all moderator-only.
        .route(
            "/moderation/sanctions",
            post(sanctions::create_sanction).get(sanctions::list_sanctions),
        )
        .route(
            "/moderation/sanctions/{id}/revoke",
            patch(sanctions::revoke_sanction),
        )
        .route(
            "/moderation/sanctions/user/{user_id}",
            get(sanctions::user_sanctions),
        )
        // Appeals — POST is open, list/respond are moderator-only.
        .route(
            "/moderation/appeals",
            post(appeals::create_appeal).get(appeals::list_appeals),
        )
        .route(
            "/moderation/appeals/{id}/respond",
            patch(appeals::respond_appeal),
        )
}
