use axum::Json;
use axum::extract::{Path, Query, State};
use sea_orm::ActiveValue::Set;
use uuid::Uuid;

use crate::AppState;
use eulesia_auth::session::AuthUser;
use eulesia_common::error::ApiError;
use eulesia_common::types::new_id;
use eulesia_db::repo::reports::ReportRepo;

use eulesia_common::types::ReportStatus;

use super::require_moderator;
use super::types::{
    CreateReportRequest, ReportListParams, ReportListResponse, ReportResponse, UpdateReportRequest,
};

const DEFAULT_LIMIT: u64 = 20;
const MAX_LIMIT: u64 = 100;

fn clamp_limit(limit: Option<u64>) -> u64 {
    limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT)
}

fn report_to_response(r: eulesia_db::entities::content_reports::Model) -> ReportResponse {
    ReportResponse {
        id: r.id,
        reporter_id: r.reporter_id,
        content_type: r.content_type,
        content_id: r.content_id,
        reason: r.reason,
        description: r.description,
        status: r.status,
        assigned_to: r.assigned_to,
        resolved_at: r.resolved_at.map(|t| t.to_rfc3339()),
        created_at: r.created_at.to_rfc3339(),
    }
}

/// POST /moderation/reports — any authenticated user can file a report.
pub async fn create_report(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateReportRequest>,
) -> Result<Json<ReportResponse>, ApiError> {
    let id = new_id();
    let now = chrono::Utc::now().fixed_offset();

    let model = eulesia_db::entities::content_reports::ActiveModel {
        id: Set(id),
        reporter_id: Set(auth.user_id.0),
        content_type: Set(req.content_type),
        content_id: Set(req.content_id),
        reason: Set(req.reason.as_str().to_owned()),
        description: Set(req.description),
        status: Set(ReportStatus::Pending.as_str().to_owned()),
        created_at: Set(now),
        ..Default::default()
    };

    let report = ReportRepo::create(&state.db, model)
        .await
        .map_err(|e| ApiError::Database(format!("create report: {e}")))?;
    Ok(Json(report_to_response(report)))
}

/// GET /moderation/reports — moderator-only list.
pub async fn list_reports(
    auth: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<ReportListParams>,
) -> Result<Json<ReportListResponse>, ApiError> {
    require_moderator(&state.db, auth.user_id.0).await?;

    let offset = params.offset.unwrap_or(0);
    let limit = clamp_limit(params.limit);

    let status_str = params.status.map(|s| s.as_str());
    let (items, total) = ReportRepo::list(&state.db, status_str, offset, limit)
        .await
        .map_err(|e| ApiError::Database(format!("list reports: {e}")))?;

    let data = items.into_iter().map(report_to_response).collect();

    Ok(Json(ReportListResponse {
        data,
        total,
        offset,
        limit,
    }))
}

/// GET /moderation/reports/{id} — moderator-only detail.
pub async fn get_report(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ReportResponse>, ApiError> {
    require_moderator(&state.db, auth.user_id.0).await?;

    let report = ReportRepo::find_by_id(&state.db, id)
        .await
        .map_err(|e| ApiError::Database(format!("find report: {e}")))?
        .ok_or_else(|| ApiError::NotFound("report not found".into()))?;

    Ok(Json(report_to_response(report)))
}

/// PATCH /moderation/reports/{id} — moderator-only update (status, assignment).
pub async fn update_report(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateReportRequest>,
) -> Result<Json<ReportResponse>, ApiError> {
    require_moderator(&state.db, auth.user_id.0).await?;

    // Ensure report exists.
    ReportRepo::find_by_id(&state.db, id)
        .await
        .map_err(|e| ApiError::Database(format!("find report: {e}")))?
        .ok_or_else(|| ApiError::NotFound("report not found".into()))?;

    if let Some(status) = req.status {
        let resolved_at = if matches!(status, ReportStatus::Resolved) {
            Some(chrono::Utc::now().fixed_offset())
        } else {
            None
        };
        ReportRepo::update_status(&state.db, id, status.as_str(), resolved_at)
            .await
            .map_err(|e| ApiError::Database(format!("update report status: {e}")))?;
    }

    if let Some(moderator_id) = req.assigned_to {
        ReportRepo::assign(&state.db, id, moderator_id)
            .await
            .map_err(|e| ApiError::Database(format!("assign report: {e}")))?;
    }

    let updated = ReportRepo::find_by_id(&state.db, id)
        .await
        .map_err(|e| ApiError::Database(format!("find report: {e}")))?
        .ok_or_else(|| ApiError::NotFound("report not found".into()))?;

    Ok(Json(report_to_response(updated)))
}
