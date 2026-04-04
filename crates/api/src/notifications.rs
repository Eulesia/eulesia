use axum::extract::{Path, Query, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use sea_orm::ActiveValue::Set;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use eulesia_auth::session::AuthUser;
use eulesia_common::error::ApiError;
use eulesia_common::types::{PaginationParams, new_id};
use eulesia_db::repo::notifications::NotificationRepo;
use eulesia_db::repo::push_subscriptions::PushSubscriptionRepo;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct NotificationResponse {
    id: Uuid,
    event_type: String,
    title: String,
    body: Option<String>,
    link: Option<String>,
    read: bool,
    created_at: String,
}

impl From<eulesia_db::entities::notifications::Model> for NotificationResponse {
    fn from(n: eulesia_db::entities::notifications::Model) -> Self {
        Self {
            id: n.id,
            event_type: n.event_type,
            title: n.title,
            body: n.body,
            link: n.link,
            read: n.read,
            created_at: n.created_at.to_rfc3339(),
        }
    }
}

#[derive(Serialize)]
struct NotificationListResponse {
    data: Vec<NotificationResponse>,
    total: u64,
}

#[derive(Serialize)]
struct UnreadCountResponse {
    count: u64,
}

#[derive(Serialize)]
struct MarkAllReadResponse {
    updated: u64,
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PushSubscribeRequest {
    endpoint: String,
    p256dh: String,
    auth: String,
}

#[derive(Deserialize)]
struct PushUnsubscribeRequest {
    endpoint: String,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn list_notifications(
    auth: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<NotificationListResponse>, ApiError> {
    let offset = u64::try_from(params.offset).unwrap_or(0);
    let limit = u64::try_from(params.limit).unwrap_or(50);

    let (items, total) = NotificationRepo::list_for_user(&state.db, auth.user_id.0, offset, limit)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let data = items.into_iter().map(NotificationResponse::from).collect();
    Ok(Json(NotificationListResponse { data, total }))
}

async fn unread_count(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<UnreadCountResponse>, ApiError> {
    let count = NotificationRepo::unread_count(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(Json(UnreadCountResponse { count }))
}

async fn mark_read(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<(), ApiError> {
    NotificationRepo::mark_read(&state.db, id, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(())
}

async fn mark_all_read(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<MarkAllReadResponse>, ApiError> {
    let updated = NotificationRepo::mark_all_read(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(Json(MarkAllReadResponse { updated }))
}

async fn delete_notification(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<(), ApiError> {
    NotificationRepo::delete(&state.db, id, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(())
}

async fn push_subscribe(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<PushSubscribeRequest>,
) -> Result<(), ApiError> {
    let now = chrono::Utc::now().fixed_offset();
    PushSubscriptionRepo::create(
        &state.db,
        eulesia_db::entities::push_subscriptions::ActiveModel {
            id: Set(new_id()),
            user_id: Set(auth.user_id.0),
            endpoint: Set(req.endpoint),
            p256dh: Set(req.p256dh),
            auth: Set(req.auth),
            user_agent: Set(None),
            created_at: Set(now),
        },
    )
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(())
}

async fn push_unsubscribe(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<PushUnsubscribeRequest>,
) -> Result<(), ApiError> {
    PushSubscriptionRepo::delete_by_endpoint(&state.db, auth.user_id.0, &req.endpoint)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/notifications", get(list_notifications))
        .route("/notifications/unread-count", get(unread_count))
        .route("/notifications/{id}/read", post(mark_read))
        .route("/notifications/read-all", post(mark_all_read))
        .route("/notifications/{id}", delete(delete_notification))
        .route(
            "/notifications/push/subscribe",
            post(push_subscribe).delete(push_unsubscribe),
        )
}
