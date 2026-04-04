use axum::Json;
use axum::extract::{Path, Query, State};
use sea_orm::ActiveValue::Set;
use uuid::Uuid;

use crate::AppState;
use eulesia_auth::session::AuthUser;
use eulesia_common::error::ApiError;
use eulesia_common::types::new_id;
use eulesia_db::repo::sanctions::SanctionRepo;

use super::require_moderator;
use super::types::{
    CreateSanctionRequest, SanctionListParams, SanctionListResponse, SanctionResponse,
};

const DEFAULT_LIMIT: u64 = 20;
const MAX_LIMIT: u64 = 100;

fn clamp_limit(limit: Option<u64>) -> u64 {
    limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT)
}

fn sanction_to_response(s: eulesia_db::entities::user_sanctions::Model) -> SanctionResponse {
    SanctionResponse {
        id: s.id,
        user_id: s.user_id,
        sanction_type: s.sanction_type,
        reason: s.reason,
        issued_by: s.issued_by,
        issued_at: s.issued_at.to_rfc3339(),
        expires_at: s.expires_at.map(|t| t.to_rfc3339()),
        revoked_at: s.revoked_at.map(|t| t.to_rfc3339()),
        revoked_by: s.revoked_by,
    }
}

/// POST /moderation/sanctions — moderator-only.
pub async fn create_sanction(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateSanctionRequest>,
) -> Result<Json<SanctionResponse>, ApiError> {
    require_moderator(&state.db, auth.user_id.0).await?;

    let id = new_id();
    let now = chrono::Utc::now().fixed_offset();

    let expires_at = req
        .expires_at
        .as_deref()
        .map(|s| {
            chrono::DateTime::parse_from_rfc3339(s)
                .map_err(|_| ApiError::BadRequest("invalid expires_at datetime".into()))
        })
        .transpose()?;

    let model = eulesia_db::entities::user_sanctions::ActiveModel {
        id: Set(id),
        user_id: Set(req.user_id),
        sanction_type: Set(req.sanction_type.as_str().to_owned()),
        reason: Set(req.reason),
        issued_by: Set(auth.user_id.0),
        issued_at: Set(now),
        expires_at: Set(expires_at),
        ..Default::default()
    };

    let sanction = SanctionRepo::create(&state.db, model)
        .await
        .map_err(|e| ApiError::Database(format!("create sanction: {e}")))?;
    Ok(Json(sanction_to_response(sanction)))
}

/// GET /moderation/sanctions — moderator-only list.
pub async fn list_sanctions(
    auth: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<SanctionListParams>,
) -> Result<Json<SanctionListResponse>, ApiError> {
    require_moderator(&state.db, auth.user_id.0).await?;

    let offset = params.offset.unwrap_or(0);
    let limit = clamp_limit(params.limit);

    let (items, total) = SanctionRepo::list(&state.db, offset, limit)
        .await
        .map_err(|e| ApiError::Database(format!("list sanctions: {e}")))?;

    let data = items.into_iter().map(sanction_to_response).collect();

    Ok(Json(SanctionListResponse {
        data,
        total,
        offset,
        limit,
    }))
}

/// PATCH /moderation/sanctions/{id}/revoke — moderator-only.
pub async fn revoke_sanction(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<SanctionResponse>, ApiError> {
    require_moderator(&state.db, auth.user_id.0).await?;

    SanctionRepo::find_by_id(&state.db, id)
        .await
        .map_err(|e| ApiError::Database(format!("find sanction: {e}")))?
        .ok_or_else(|| ApiError::NotFound("sanction not found".into()))?;

    SanctionRepo::revoke(&state.db, id, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(format!("revoke sanction: {e}")))?;

    let updated = SanctionRepo::find_by_id(&state.db, id)
        .await
        .map_err(|e| ApiError::Database(format!("find sanction: {e}")))?
        .ok_or_else(|| ApiError::NotFound("sanction not found".into()))?;

    Ok(Json(sanction_to_response(updated)))
}

/// GET `/moderation/sanctions/user/{user_id}` — moderator-only; active sanctions for a user.
pub async fn user_sanctions(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Vec<SanctionResponse>>, ApiError> {
    require_moderator(&state.db, auth.user_id.0).await?;

    let items = SanctionRepo::active_for_user(&state.db, user_id)
        .await
        .map_err(|e| ApiError::Database(format!("list active sanctions for user: {e}")))?;

    let data = items.into_iter().map(sanction_to_response).collect();
    Ok(Json(data))
}
