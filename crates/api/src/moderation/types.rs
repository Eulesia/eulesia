use eulesia_common::types::{AppealStatus, ReportReason, ReportStatus, SanctionType};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateReportRequest {
    pub content_type: String,
    pub content_id: Uuid,
    pub reason: ReportReason,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateReportRequest {
    pub status: Option<ReportStatus>,
    pub assigned_to: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ReportListParams {
    pub status: Option<ReportStatus>,
    pub offset: Option<u64>,
    pub limit: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSanctionRequest {
    pub user_id: Uuid,
    pub sanction_type: SanctionType,
    pub reason: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SanctionListParams {
    pub offset: Option<u64>,
    pub limit: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAppealRequest {
    pub sanction_id: Uuid,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct AppealListParams {
    pub status: Option<AppealStatus>,
    pub offset: Option<u64>,
    pub limit: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct RespondAppealRequest {
    pub admin_response: String,
    pub status: AppealStatus,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ReportResponse {
    pub id: Uuid,
    pub reporter_id: Uuid,
    pub content_type: String,
    pub content_id: Uuid,
    pub reason: String,
    pub description: Option<String>,
    pub status: String,
    pub assigned_to: Option<Uuid>,
    pub resolved_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ReportListResponse {
    pub data: Vec<ReportResponse>,
    pub total: u64,
    pub offset: u64,
    pub limit: u64,
}

#[derive(Debug, Serialize)]
pub struct SanctionResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub sanction_type: String,
    pub reason: Option<String>,
    pub issued_by: Uuid,
    pub issued_at: String,
    pub expires_at: Option<String>,
    pub revoked_at: Option<String>,
    pub revoked_by: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct SanctionListResponse {
    pub data: Vec<SanctionResponse>,
    pub total: u64,
    pub offset: u64,
    pub limit: u64,
}

#[derive(Debug, Serialize)]
pub struct AppealResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub sanction_id: Option<Uuid>,
    pub report_id: Option<Uuid>,
    pub action_id: Option<Uuid>,
    pub reason: String,
    pub status: String,
    pub admin_response: Option<String>,
    pub responded_by: Option<Uuid>,
    pub responded_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct AppealListResponse {
    pub data: Vec<AppealResponse>,
    pub total: u64,
    pub offset: u64,
    pub limit: u64,
}
