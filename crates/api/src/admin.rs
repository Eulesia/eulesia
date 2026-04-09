use axum::extract::{Path, Query, State};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use axum_extra::extract::CookieJar;
use axum_extra::extract::cookie::{Cookie, SameSite};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tracing::warn;
use uuid::Uuid;
use webauthn_rs::prelude::*;

use crate::{AppConfig, AppState};
use eulesia_auth::password;
use eulesia_common::error::ApiError;
use eulesia_common::types::{AppealStatus, Id, ReportStatus, SanctionType, new_id};
use eulesia_db::entities::{
    admin_accounts, admin_passkeys, admin_pending_sessions, admin_recovery_codes, admin_sessions,
    comments, threads,
};
use eulesia_db::repo::outbox_helpers::emit_event;
use eulesia_db::repo::{appeals::AppealRepo, sanctions::SanctionRepo, users::UserRepo};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn db_err(e: sea_orm::DbErr) -> ApiError {
    ApiError::Database(e.to_string())
}

/// SHA-256 hash a raw token string and return the hex digest.
fn sha256_hex(input: &str) -> String {
    let hash = Sha256::digest(input.as_bytes());
    hex::encode(hash)
}

/// Generate a cryptographically random token (32 bytes, base64-encoded).
fn generate_admin_token() -> String {
    use base64::Engine;
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

// ---------------------------------------------------------------------------
// Admin session cookie
// ---------------------------------------------------------------------------

const ADMIN_SESSION_MAX_AGE_DAYS: i64 = 30;

fn build_admin_session_cookie(token: &str, config: &AppConfig) -> Cookie<'static> {
    let mut cookie = Cookie::build(("admin_session", token.to_string()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(time::Duration::days(ADMIN_SESSION_MAX_AGE_DAYS))
        .build();

    if config.cookie_secure {
        cookie.set_secure(true);
    }
    if let Some(ref domain) = config.cookie_domain {
        cookie.set_domain(domain.clone());
    }

    cookie
}

fn clear_admin_session_cookie(config: &AppConfig) -> Cookie<'static> {
    let mut cookie = Cookie::build("admin_session")
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(time::Duration::ZERO)
        .build();

    if config.cookie_secure {
        cookie.set_secure(true);
    }
    if let Some(ref domain) = config.cookie_domain {
        cookie.set_domain(domain.clone());
    }

    cookie
}

// ---------------------------------------------------------------------------
// Admin session validation
// ---------------------------------------------------------------------------

/// Validate the `admin_session` cookie and return the authenticated admin
/// account. This is the single gating helper used by every admin endpoint.
async fn require_admin(
    jar: &CookieJar,
    state: &AppState,
) -> Result<admin_accounts::Model, ApiError> {
    let token = jar
        .get("admin_session")
        .map(|c| c.value().to_string())
        .ok_or(ApiError::Unauthorized)?;

    let token_hash = sha256_hex(&token);

    // Look up the session by token hash
    let session = admin_sessions::Entity::find()
        .filter(admin_sessions::Column::TokenHash.eq(&token_hash))
        .one(&*state.db)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Unauthorized)?;

    // Verify not expired
    let now = chrono::Utc::now().fixed_offset();
    if session.expires_at < now {
        // Clean up expired session
        let _ = admin_sessions::Entity::delete_by_id(session.id)
            .exec(&*state.db)
            .await;
        return Err(ApiError::Unauthorized);
    }

    // Load the admin account
    let admin = admin_accounts::Entity::find_by_id(session.admin_id)
        .one(&*state.db)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Unauthorized)?;

    // Enforce 2FA enrollment
    let enrolled = has_2fa_enrolled(&admin, &*state.db).await?;
    if !enrolled {
        return Err(ApiError::Forbidden);
    }

    Ok(admin)
}

// ---------------------------------------------------------------------------
// Pending session cookie helpers
// ---------------------------------------------------------------------------

const PENDING_SESSION_MAX_AGE_MINUTES: i64 = 10;

fn build_pending_session_cookie(token: &str, config: &AppConfig) -> Cookie<'static> {
    let mut cookie = Cookie::build(("admin_pending_session", token.to_string()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(time::Duration::minutes(PENDING_SESSION_MAX_AGE_MINUTES))
        .build();
    if config.cookie_secure {
        cookie.set_secure(true);
    }
    if let Some(ref domain) = config.cookie_domain {
        cookie.set_domain(domain.clone());
    }
    cookie
}

fn clear_pending_session_cookie(config: &AppConfig) -> Cookie<'static> {
    let mut cookie = Cookie::build("admin_pending_session")
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(time::Duration::ZERO)
        .build();
    if config.cookie_secure {
        cookie.set_secure(true);
    }
    if let Some(ref domain) = config.cookie_domain {
        cookie.set_domain(domain.clone());
    }
    cookie
}

// ---------------------------------------------------------------------------
// 2FA helpers
// ---------------------------------------------------------------------------

async fn create_pending_session(
    admin_id: Uuid,
    db: &sea_orm::DatabaseConnection,
) -> Result<String, ApiError> {
    let raw_token = generate_admin_token();
    let token_hash = sha256_hex(&raw_token);
    let now = chrono::Utc::now().fixed_offset();
    let expires_at = now + chrono::Duration::minutes(PENDING_SESSION_MAX_AGE_MINUTES);
    admin_pending_sessions::ActiveModel {
        id: Set(Uuid::now_v7()),
        admin_id: Set(admin_id),
        token_hash: Set(token_hash),
        webauthn_state: Set(None),
        totp_secret_temp: Set(None),
        expires_at: Set(expires_at),
        created_at: Set(now),
    }
    .insert(db)
    .await
    .map_err(db_err)?;
    Ok(raw_token)
}

async fn require_pending_session(
    jar: &CookieJar,
    state: &AppState,
) -> Result<(admin_pending_sessions::Model, admin_accounts::Model), ApiError> {
    let token = jar
        .get("admin_pending_session")
        .map(|c| c.value().to_string())
        .ok_or(ApiError::Unauthorized)?;
    let token_hash = sha256_hex(&token);
    let pending = admin_pending_sessions::Entity::find()
        .filter(admin_pending_sessions::Column::TokenHash.eq(&token_hash))
        .one(&*state.db)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Unauthorized)?;
    let now = chrono::Utc::now().fixed_offset();
    if pending.expires_at < now {
        let _ = admin_pending_sessions::Entity::delete_by_id(pending.id)
            .exec(&*state.db)
            .await;
        return Err(ApiError::Unauthorized);
    }
    let admin = admin_accounts::Entity::find_by_id(pending.admin_id)
        .one(&*state.db)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Unauthorized)?;
    Ok((pending, admin))
}

async fn has_2fa_enrolled(
    admin: &admin_accounts::Model,
    db: &sea_orm::DatabaseConnection,
) -> Result<bool, ApiError> {
    if admin.totp_enabled {
        return Ok(true);
    }
    let passkey_count = admin_passkeys::Entity::find()
        .filter(admin_passkeys::Column::AdminId.eq(admin.id))
        .count(db)
        .await
        .map_err(db_err)?;
    Ok(passkey_count > 0)
}

async fn promote_to_full_session(
    pending: &admin_pending_sessions::Model,
    state: &AppState,
) -> Result<String, ApiError> {
    admin_pending_sessions::Entity::delete_by_id(pending.id)
        .exec(&*state.db)
        .await
        .map_err(db_err)?;
    let raw_token = generate_admin_token();
    let token_hash = sha256_hex(&raw_token);
    let now = chrono::Utc::now().fixed_offset();
    let expires_at = now + chrono::Duration::days(ADMIN_SESSION_MAX_AGE_DAYS);
    admin_sessions::ActiveModel {
        id: Set(Uuid::now_v7()),
        admin_id: Set(pending.admin_id),
        token_hash: Set(token_hash),
        ip_address: sea_orm::ActiveValue::NotSet,
        user_agent: sea_orm::ActiveValue::NotSet,
        expires_at: Set(expires_at),
        created_at: Set(now),
    }
    .insert(&*state.db)
    .await
    .map_err(db_err)?;
    admin_accounts::Entity::update_many()
        .col_expr(
            admin_accounts::Column::LastSeenAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(admin_accounts::Column::Id.eq(pending.admin_id))
        .exec(&*state.db)
        .await
        .map_err(db_err)?;
    Ok(raw_token)
}

async fn generate_recovery_codes(
    admin_id: Uuid,
    db: &sea_orm::DatabaseConnection,
) -> Result<Vec<String>, ApiError> {
    use base64::Engine;
    use rand::RngCore;
    admin_recovery_codes::Entity::delete_many()
        .filter(admin_recovery_codes::Column::AdminId.eq(admin_id))
        .exec(db)
        .await
        .map_err(db_err)?;
    let now = chrono::Utc::now().fixed_offset();
    let mut codes = Vec::with_capacity(8);
    for _ in 0..8 {
        let mut bytes = [0u8; 5];
        rand::rng().fill_bytes(&mut bytes);
        let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(bytes)
            .to_uppercase();
        let code = if raw.len() >= 8 {
            format!("{}-{}", &raw[..4], &raw[4..8])
        } else {
            raw.clone()
        };
        let code_hash = sha256_hex(&code);
        admin_recovery_codes::ActiveModel {
            id: Set(Uuid::now_v7()),
            admin_id: Set(admin_id),
            code_hash: Set(code_hash),
            used_at: Set(None),
            created_at: Set(now),
        }
        .insert(db)
        .await
        .map_err(db_err)?;
        codes.push(code);
    }
    Ok(codes)
}

fn paginate(
    page: Option<u64>,
    limit: Option<u64>,
    default_limit: u64,
    max_limit: u64,
) -> (u64, u64, u64) {
    let max_pagination_value = i64::MAX as u64;
    let max_limit = max_limit.clamp(1, max_pagination_value);
    let default_limit = default_limit.clamp(1, max_limit);
    let limit = limit.unwrap_or(default_limit).clamp(1, max_limit);

    let max_page = max_pagination_value
        .checked_div(limit)
        .and_then(|value| value.checked_add(1))
        .unwrap_or(1);
    let page = page.unwrap_or(1).clamp(1, max_page);

    let offset = page
        .checked_sub(1)
        .and_then(|value| value.checked_mul(limit))
        .unwrap_or(max_pagination_value);
    (page, limit, offset)
}

fn pagination_sql_value(value: u64) -> i64 {
    i64::try_from(value).expect("pagination values are clamped to i64::MAX")
}

const fn has_more(total: u64, offset: u64, limit: u64) -> bool {
    offset.saturating_add(limit) < total
}

fn action_type_for_api(action_type: &str) -> String {
    match action_type {
        "content_delete" => "content_removed",
        "content_restore" => "content_restored",
        other => other,
    }
    .to_owned()
}

async fn actor_name_by_id(
    db: &sea_orm::DatabaseConnection,
    actor_id: Uuid,
) -> Result<Option<String>, sea_orm::DbErr> {
    if let Some(user) = UserRepo::find_by_id(db, actor_id).await? {
        return Ok(Some(user.name));
    }

    Ok(admin_accounts::Entity::find_by_id(actor_id)
        .one(db)
        .await?
        .map(|admin| admin.name))
}

fn parse_api_datetime(
    value: &str,
    field_name: &'static str,
) -> Result<chrono::DateTime<chrono::FixedOffset>, ApiError> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| ApiError::BadRequest(format!("invalid {field_name} format")))
}

const fn should_sync_thread_search(thread: &threads::Model) -> bool {
    thread.club_id.is_none() && !thread.is_hidden
}

fn thread_search_payload(thread: &threads::Model) -> serde_json::Value {
    serde_json::json!({
        "id": thread.id.to_string(),
        "title": thread.title,
        "content": thread.content,
        "author_id": thread.author_id.to_string(),
        "scope": thread.scope,
        "created_at": thread.created_at.timestamp(),
    })
}

async fn write_moderation_action(
    db: &impl ConnectionTrait,
    admin_id: Uuid,
    action_type: &str,
    target_type: &str,
    target_id: Uuid,
    reason: Option<String>,
) -> Result<(), sea_orm::DbErr> {
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r"INSERT INTO moderation_actions (id, admin_id, action_type, target_type, target_id, reason, created_at)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())",
        [
            admin_id.into(),
            action_type.into(),
            target_type.into(),
            target_id.into(),
            reason.into(),
        ],
    ))
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Response types (auth)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminProfile {
    id: Id,
    username: String,
    name: String,
    email: Option<String>,
}

impl From<&admin_accounts::Model> for AdminProfile {
    fn from(a: &admin_accounts::Model) -> Self {
        Self {
            id: a.id,
            username: a.username.clone(),
            name: a.name.clone(),
            email: a.email.clone(),
        }
    }
}

// ===========================================================================
// Auth Endpoints
// ===========================================================================

/// POST /admin/auth/login -- authenticate via admin_accounts.
#[derive(Deserialize)]
struct AdminLoginRequest {
    username: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminLoginResponse {
    status: String,
}

async fn admin_login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<AdminLoginRequest>,
) -> Result<(CookieJar, Json<AdminLoginResponse>), ApiError> {
    // Look up admin by username
    let admin = admin_accounts::Entity::find()
        .filter(admin_accounts::Column::Username.eq(&req.username))
        .one(&*state.db)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Unauthorized)?;

    // Verify password (spawn_blocking because argon2 is CPU-intensive)
    let pw = req.password.clone();
    let hash = admin.password_hash.clone();
    let valid = tokio::task::spawn_blocking(move || password::verify_password(&pw, &hash))
        .await
        .map_err(|_| ApiError::Internal("password verification task failed".into()))?
        .map_err(|_| ApiError::Internal("password hashing error".into()))?;

    if !valid {
        return Err(ApiError::Unauthorized);
    }

    let raw_token = create_pending_session(admin.id, &state.db).await?;
    let cookie = build_pending_session_cookie(&raw_token, &state.config);
    let jar = jar.add(cookie);
    let enrolled = has_2fa_enrolled(&admin, &state.db).await?;
    let status = if enrolled {
        "totp_required"
    } else {
        "setup_required"
    };
    Ok((
        jar,
        Json(AdminLoginResponse {
            status: status.into(),
        }),
    ))
}

/// GET /admin/auth/me -- return the authenticated admin's profile.
async fn admin_me(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<AdminProfile>, ApiError> {
    let admin = require_admin(&jar, &state).await?;
    Ok(Json(AdminProfile::from(&admin)))
}

/// POST /admin/auth/logout -- delete the admin session and clear cookie.
async fn admin_logout(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<CookieJar, ApiError> {
    if let Some(token) = jar.get("admin_session").map(|c| c.value().to_string()) {
        let token_hash = sha256_hex(&token);
        // Delete the session record
        admin_sessions::Entity::delete_many()
            .filter(admin_sessions::Column::TokenHash.eq(&token_hash))
            .exec(&*state.db)
            .await
            .map_err(db_err)?;
    }

    let jar = jar.add(clear_admin_session_cookie(&state.config));
    Ok(jar)
}

/// POST /admin/auth/change-password -- change admin's own password.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminChangePasswordRequest {
    current_password: String,
    new_password: String,
}

async fn admin_change_password(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<AdminChangePasswordRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    if req.new_password.len() < 8 {
        return Err(ApiError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }

    // Verify current password
    let current = req.current_password.clone();
    let stored = admin.password_hash.clone();
    let valid = tokio::task::spawn_blocking(move || password::verify_password(&current, &stored))
        .await
        .map_err(|_| ApiError::Internal("password verification task failed".into()))?
        .map_err(|_| ApiError::Internal("password hashing error".into()))?;

    if !valid {
        return Err(ApiError::BadRequest("incorrect current password".into()));
    }

    // Hash new password
    let new_pw = req.new_password.clone();
    let new_hash = tokio::task::spawn_blocking(move || password::hash_password(&new_pw))
        .await
        .map_err(|_| ApiError::Internal("password hashing task failed".into()))?
        .map_err(|e| ApiError::Internal(format!("hash password: {e}")))?;

    // Update password
    let mut active: admin_accounts::ActiveModel = admin.into();
    active.password_hash = Set(new_hash);
    active.updated_at = Set(chrono::Utc::now().fixed_offset());
    active.update(&*state.db).await.map_err(db_err)?;

    Ok(Json(serde_json::json!({ "changed": true })))
}

// ===========================================================================
// 2FA — TOTP Endpoints
// ===========================================================================

/// POST /admin/auth/totp/setup/begin
async fn admin_totp_setup_begin(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Accept pending OR full session
    let (pending, admin) = if let Ok(result) = require_pending_session(&jar, &state).await {
        result
    } else {
        let admin = require_admin(&jar, &state).await?;
        let raw_token = create_pending_session(admin.id, &state.db).await?;
        let pending = {
            let token_hash = sha256_hex(&raw_token);
            admin_pending_sessions::Entity::find()
                .filter(admin_pending_sessions::Column::TokenHash.eq(&token_hash))
                .one(&*state.db)
                .await
                .map_err(db_err)?
                .ok_or(ApiError::Internal("pending session not found".into()))?
        };
        (pending, admin)
    };

    let secret = totp_rs::Secret::generate_secret();
    let secret_base32 = secret.to_encoded().to_string();
    let totp = totp_rs::TOTP::new(
        totp_rs::Algorithm::SHA1,
        6,
        1,
        30,
        secret
            .to_bytes()
            .map_err(|e| ApiError::Internal(format!("totp secret: {e}")))?,
        Some("Eulesia Admin".to_string()),
        admin.username.clone(),
    )
    .map_err(|e| ApiError::Internal(format!("totp init: {e}")))?;

    let qr_png = totp
        .get_qr_png()
        .map_err(|e| ApiError::Internal(format!("qr: {e}")))?;
    let qr_uri = format!(
        "data:image/png;base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &qr_png)
    );
    let mut active: admin_pending_sessions::ActiveModel = pending.into();
    active.totp_secret_temp = Set(Some(secret_base32.clone()));
    active.update(&*state.db).await.map_err(db_err)?;

    Ok(Json(serde_json::json!({
        "secret": secret_base32,
        "qrUri": qr_uri,
    })))
}

/// POST /admin/auth/totp/setup/confirm
#[derive(Deserialize)]
struct TotpConfirmRequest {
    code: String,
}

async fn admin_totp_setup_confirm(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<TotpConfirmRequest>,
) -> Result<(CookieJar, Json<serde_json::Value>), ApiError> {
    let (pending, admin) = require_pending_session(&jar, &state).await?;
    let secret_b32 = pending
        .totp_secret_temp
        .as_deref()
        .ok_or_else(|| ApiError::BadRequest("no TOTP setup in progress".into()))?;

    let secret = totp_rs::Secret::Encoded(secret_b32.to_string());
    let totp = totp_rs::TOTP::new(
        totp_rs::Algorithm::SHA1,
        6,
        1,
        30,
        secret
            .to_bytes()
            .map_err(|e| ApiError::Internal(format!("totp secret: {e}")))?,
        Some("Eulesia Admin".to_string()),
        admin.username.clone(),
    )
    .map_err(|e| ApiError::Internal(format!("totp init: {e}")))?;

    if !totp
        .check_current(&req.code)
        .map_err(|e| ApiError::Internal(format!("totp check: {e}")))?
    {
        return Err(ApiError::BadRequest("invalid TOTP code".into()));
    }

    // Enable TOTP on admin account
    let mut active: admin_accounts::ActiveModel = admin.clone().into();
    active.totp_secret = Set(Some(secret_b32.to_string()));
    active.totp_enabled = Set(true);
    active.updated_at = Set(chrono::Utc::now().fixed_offset());
    active.update(&*state.db).await.map_err(db_err)?;

    // Generate recovery codes
    let codes = generate_recovery_codes(admin.id, &state.db).await?;

    // Promote to full session
    let raw_token = promote_to_full_session(&pending, &state).await?;
    let mut jar = jar.add(build_admin_session_cookie(&raw_token, &state.config));
    jar = jar.add(clear_pending_session_cookie(&state.config));

    Ok((
        jar,
        Json(serde_json::json!({
            "profile": AdminProfile::from(&admin),
            "recoveryCodes": codes,
        })),
    ))
}

/// POST /admin/auth/totp/verify
#[derive(Deserialize)]
struct TotpVerifyRequest {
    code: String,
}

async fn admin_totp_verify(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<TotpVerifyRequest>,
) -> Result<(CookieJar, Json<AdminProfile>), ApiError> {
    let (pending, admin) = require_pending_session(&jar, &state).await?;
    let secret_b32 = admin
        .totp_secret
        .as_deref()
        .ok_or_else(|| ApiError::BadRequest("TOTP not configured".into()))?;

    let secret = totp_rs::Secret::Encoded(secret_b32.to_string());
    let totp = totp_rs::TOTP::new(
        totp_rs::Algorithm::SHA1,
        6,
        1,
        30,
        secret
            .to_bytes()
            .map_err(|e| ApiError::Internal(format!("totp secret: {e}")))?,
        Some("Eulesia Admin".to_string()),
        admin.username.clone(),
    )
    .map_err(|e| ApiError::Internal(format!("totp init: {e}")))?;

    if !totp
        .check_current(&req.code)
        .map_err(|e| ApiError::Internal(format!("totp check: {e}")))?
    {
        return Err(ApiError::Unauthorized);
    }

    let raw_token = promote_to_full_session(&pending, &state).await?;
    let mut jar = jar.add(build_admin_session_cookie(&raw_token, &state.config));
    jar = jar.add(clear_pending_session_cookie(&state.config));

    Ok((jar, Json(AdminProfile::from(&admin))))
}

/// POST /admin/auth/totp/recovery
#[derive(Deserialize)]
struct TotpRecoveryRequest {
    code: String,
}

async fn admin_totp_recovery(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<TotpRecoveryRequest>,
) -> Result<(CookieJar, Json<AdminProfile>), ApiError> {
    let (pending, admin) = require_pending_session(&jar, &state).await?;
    let code_hash = sha256_hex(&req.code);

    let recovery = admin_recovery_codes::Entity::find()
        .filter(admin_recovery_codes::Column::AdminId.eq(admin.id))
        .filter(admin_recovery_codes::Column::CodeHash.eq(&code_hash))
        .filter(admin_recovery_codes::Column::UsedAt.is_null())
        .one(&*state.db)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Unauthorized)?;

    // Mark as used
    let mut active: admin_recovery_codes::ActiveModel = recovery.into();
    active.used_at = Set(Some(chrono::Utc::now().fixed_offset()));
    active.update(&*state.db).await.map_err(db_err)?;

    let raw_token = promote_to_full_session(&pending, &state).await?;
    let mut jar = jar.add(build_admin_session_cookie(&raw_token, &state.config));
    jar = jar.add(clear_pending_session_cookie(&state.config));

    Ok((jar, Json(AdminProfile::from(&admin))))
}

// ===========================================================================
// 2FA — Passkey Endpoints
// ===========================================================================

/// POST /admin/auth/passkey/register/begin
async fn admin_passkey_register_begin(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, Json<CreationChallengeResponse>), ApiError> {
    // Accept pending or full session
    let (pending, admin) = if let Ok(result) = require_pending_session(&jar, &state).await {
        result
    } else {
        let admin = require_admin(&jar, &state).await?;
        let raw_token = create_pending_session(admin.id, &state.db).await?;
        let pending = {
            let token_hash = sha256_hex(&raw_token);
            admin_pending_sessions::Entity::find()
                .filter(admin_pending_sessions::Column::TokenHash.eq(&token_hash))
                .one(&*state.db)
                .await
                .map_err(db_err)?
                .ok_or(ApiError::Internal("pending session not found".into()))?
        };
        (pending, admin)
    };

    // Load existing passkeys for exclusion
    let existing = admin_passkeys::Entity::find()
        .filter(admin_passkeys::Column::AdminId.eq(admin.id))
        .all(&*state.db)
        .await
        .map_err(db_err)?;

    let exclude: Vec<CredentialID> = existing
        .iter()
        .filter_map(|pk| {
            serde_json::from_value::<Passkey>(pk.credential.clone())
                .ok()
                .map(|p| p.cred_id().clone())
        })
        .collect();

    let (ccr, reg_state) = state
        .webauthn
        .start_passkey_registration(admin.id, &admin.username, &admin.name, Some(exclude))
        .map_err(|e| ApiError::Internal(format!("webauthn register begin: {e}")))?;

    // Store reg_state in pending session
    let state_json = serde_json::to_value(&reg_state)
        .map_err(|e| ApiError::Internal(format!("serialize reg_state: {e}")))?;
    let mut active: admin_pending_sessions::ActiveModel = pending.into();
    active.webauthn_state = Set(Some(state_json));
    active.update(&*state.db).await.map_err(db_err)?;

    let jar = jar.add(build_pending_session_cookie(
        jar.get("admin_pending_session")
            .map(|c| c.value())
            .unwrap_or(""),
        &state.config,
    ));

    Ok((jar, Json(ccr)))
}

/// POST /admin/auth/passkey/register/finish
#[derive(Deserialize)]
struct PasskeyRegisterFinishRequest {
    credential: RegisterPublicKeyCredential,
    name: String,
}

async fn admin_passkey_register_finish(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<PasskeyRegisterFinishRequest>,
) -> Result<(CookieJar, Json<serde_json::Value>), ApiError> {
    let (pending, admin) = require_pending_session(&jar, &state).await?;
    let state_json = pending
        .webauthn_state
        .as_ref()
        .ok_or_else(|| ApiError::BadRequest("no passkey registration in progress".into()))?;

    let reg_state: PasskeyRegistration = serde_json::from_value(state_json.clone())
        .map_err(|e| ApiError::Internal(format!("deserialize reg_state: {e}")))?;

    let passkey = state
        .webauthn
        .finish_passkey_registration(&req.credential, &reg_state)
        .map_err(|e| ApiError::BadRequest(format!("webauthn register finish: {e}")))?;

    let credential_json = serde_json::to_value(&passkey)
        .map_err(|e| ApiError::Internal(format!("serialize passkey: {e}")))?;
    let now = chrono::Utc::now().fixed_offset();

    admin_passkeys::ActiveModel {
        id: Set(Uuid::now_v7()),
        admin_id: Set(admin.id),
        credential_id: Set(passkey.cred_id().to_vec()),
        credential: Set(credential_json),
        name: Set(req.name),
        created_at: Set(now),
        last_used_at: Set(None),
    }
    .insert(&*state.db)
    .await
    .map_err(db_err)?;

    // Check if this was a pending-flow (initial setup) or full-session flow
    let has_full_session = jar.get("admin_session").is_some();

    if has_full_session {
        // Full session flow — clean up pending session, no promotion needed
        let _ = admin_pending_sessions::Entity::delete_by_id(pending.id)
            .exec(&*state.db)
            .await;
        let jar = jar.add(clear_pending_session_cookie(&state.config));
        Ok((
            jar,
            Json(serde_json::json!({
                "profile": null,
                "recoveryCodes": null,
            })),
        ))
    } else {
        // Pending flow — generate recovery codes and promote
        let codes = generate_recovery_codes(admin.id, &state.db).await?;
        let raw_token = promote_to_full_session(&pending, &state).await?;
        let mut jar = jar.add(build_admin_session_cookie(&raw_token, &state.config));
        jar = jar.add(clear_pending_session_cookie(&state.config));
        Ok((
            jar,
            Json(serde_json::json!({
                "profile": AdminProfile::from(&admin),
                "recoveryCodes": codes,
            })),
        ))
    }
}

/// POST /admin/auth/passkey/auth/begin
async fn admin_passkey_auth_begin(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, Json<RequestChallengeResponse>), ApiError> {
    // If pending session exists, scope to that admin's passkeys
    let (pending, passkeys) =
        if let Ok((pending, admin)) = require_pending_session(&jar, &state).await {
            let pks = admin_passkeys::Entity::find()
                .filter(admin_passkeys::Column::AdminId.eq(admin.id))
                .all(&*state.db)
                .await
                .map_err(db_err)?;
            let passkeys: Vec<Passkey> = pks
                .iter()
                .filter_map(|pk| serde_json::from_value(pk.credential.clone()).ok())
                .collect();
            (pending, passkeys)
        } else {
            // Load ALL passkeys for discoverable credential flow
            let all_pks = admin_passkeys::Entity::find()
                .all(&*state.db)
                .await
                .map_err(db_err)?;
            let passkeys: Vec<Passkey> = all_pks
                .iter()
                .filter_map(|pk| serde_json::from_value(pk.credential.clone()).ok())
                .collect();
            // Create a temporary pending session (pick first admin or fail)
            if passkeys.is_empty() {
                return Err(ApiError::BadRequest("no passkeys registered".into()));
            }
            let admin_id = all_pks[0].admin_id;
            let raw_token = create_pending_session(admin_id, &state.db).await?;
            let token_hash = sha256_hex(&raw_token);
            let pending = admin_pending_sessions::Entity::find()
                .filter(admin_pending_sessions::Column::TokenHash.eq(&token_hash))
                .one(&*state.db)
                .await
                .map_err(db_err)?
                .ok_or(ApiError::Internal("pending session not found".into()))?;
            (pending, passkeys)
        };

    if passkeys.is_empty() {
        return Err(ApiError::BadRequest("no passkeys registered".into()));
    }

    let (rcr, auth_state) = state
        .webauthn
        .start_passkey_authentication(&passkeys)
        .map_err(|e| ApiError::Internal(format!("webauthn auth begin: {e}")))?;

    let state_json = serde_json::to_value(&auth_state)
        .map_err(|e| ApiError::Internal(format!("serialize auth_state: {e}")))?;
    let mut active: admin_pending_sessions::ActiveModel = pending.into();
    active.webauthn_state = Set(Some(state_json));
    active.update(&*state.db).await.map_err(db_err)?;

    let pending_cookie_value = jar
        .get("admin_pending_session")
        .map(|c| c.value().to_string())
        .unwrap_or_default();
    let jar = jar.add(build_pending_session_cookie(
        &pending_cookie_value,
        &state.config,
    ));

    Ok((jar, Json(rcr)))
}

/// POST /admin/auth/passkey/auth/finish
async fn admin_passkey_auth_finish(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(credential): Json<PublicKeyCredential>,
) -> Result<(CookieJar, Json<AdminProfile>), ApiError> {
    let (pending, _admin) = require_pending_session(&jar, &state).await?;
    let state_json = pending
        .webauthn_state
        .as_ref()
        .ok_or_else(|| ApiError::BadRequest("no passkey auth in progress".into()))?;

    let auth_state: PasskeyAuthentication = serde_json::from_value(state_json.clone())
        .map_err(|e| ApiError::Internal(format!("deserialize auth_state: {e}")))?;

    let auth_result = state
        .webauthn
        .finish_passkey_authentication(&credential, &auth_state)
        .map_err(|e| ApiError::BadRequest(format!("webauthn auth finish: {e}")))?;

    // Find passkey by credential ID
    let cred_id_bytes = auth_result.cred_id().to_vec();
    let passkey_record = admin_passkeys::Entity::find()
        .filter(admin_passkeys::Column::CredentialId.eq(cred_id_bytes))
        .one(&*state.db)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Unauthorized)?;

    // Update counter and last_used_at
    let now = chrono::Utc::now().fixed_offset();
    let mut active: admin_passkeys::ActiveModel = passkey_record.clone().into();
    // Update the credential with new counter
    let mut stored_passkey: Passkey = serde_json::from_value(passkey_record.credential.clone())
        .map_err(|e| ApiError::Internal(format!("deserialize passkey: {e}")))?;
    stored_passkey.update_credential(&auth_result);
    active.credential = Set(serde_json::to_value(&stored_passkey)
        .map_err(|e| ApiError::Internal(format!("serialize passkey: {e}")))?);
    active.last_used_at = Set(Some(now));
    active.update(&*state.db).await.map_err(db_err)?;

    // Load the admin that owns this passkey
    let admin = admin_accounts::Entity::find_by_id(passkey_record.admin_id)
        .one(&*state.db)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::Unauthorized)?;

    let raw_token = promote_to_full_session(&pending, &state).await?;
    let mut jar = jar.add(build_admin_session_cookie(&raw_token, &state.config));
    jar = jar.add(clear_pending_session_cookie(&state.config));

    Ok((jar, Json(AdminProfile::from(&admin))))
}

/// GET /admin/auth/passkey
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PasskeyInfo {
    id: Uuid,
    name: String,
    created_at: String,
    last_used_at: Option<String>,
}

async fn admin_passkey_list(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<Vec<PasskeyInfo>>, ApiError> {
    let admin = require_admin(&jar, &state).await?;
    let passkeys = admin_passkeys::Entity::find()
        .filter(admin_passkeys::Column::AdminId.eq(admin.id))
        .order_by_asc(admin_passkeys::Column::CreatedAt)
        .all(&*state.db)
        .await
        .map_err(db_err)?;

    let items = passkeys
        .into_iter()
        .map(|pk| PasskeyInfo {
            id: pk.id,
            name: pk.name,
            created_at: pk.created_at.to_rfc3339(),
            last_used_at: pk.last_used_at.map(|t| t.to_rfc3339()),
        })
        .collect();

    Ok(Json(items))
}

/// DELETE /admin/auth/passkey/{id}
async fn admin_passkey_delete(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let admin = require_admin(&jar, &state).await?;
    let result = admin_passkeys::Entity::delete_many()
        .filter(admin_passkeys::Column::Id.eq(id))
        .filter(admin_passkeys::Column::AdminId.eq(admin.id))
        .exec(&*state.db)
        .await
        .map_err(db_err)?;

    if result.rows_affected == 0 {
        return Err(ApiError::NotFound("passkey not found".into()));
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ===========================================================================
// 2FA — Status & Reset
// ===========================================================================

/// GET /admin/auth/2fa/status
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TwoFactorStatus {
    totp_enabled: bool,
    passkeys: Vec<PasskeyInfo>,
    unused_recovery_codes: u64,
}

async fn admin_2fa_status(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<TwoFactorStatus>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    let passkeys = admin_passkeys::Entity::find()
        .filter(admin_passkeys::Column::AdminId.eq(admin.id))
        .order_by_asc(admin_passkeys::Column::CreatedAt)
        .all(&*state.db)
        .await
        .map_err(db_err)?;

    let passkey_infos: Vec<PasskeyInfo> = passkeys
        .into_iter()
        .map(|pk| PasskeyInfo {
            id: pk.id,
            name: pk.name,
            created_at: pk.created_at.to_rfc3339(),
            last_used_at: pk.last_used_at.map(|t| t.to_rfc3339()),
        })
        .collect();

    let unused_codes = admin_recovery_codes::Entity::find()
        .filter(admin_recovery_codes::Column::AdminId.eq(admin.id))
        .filter(admin_recovery_codes::Column::UsedAt.is_null())
        .count(&*state.db)
        .await
        .map_err(db_err)?;

    Ok(Json(TwoFactorStatus {
        totp_enabled: admin.totp_enabled,
        passkeys: passkey_infos,
        unused_recovery_codes: unused_codes,
    }))
}

/// POST /admin/auth/2fa/reset
#[derive(Deserialize)]
struct TwoFactorResetRequest {
    password: String,
}

async fn admin_2fa_reset(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<TwoFactorResetRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    // Verify password
    let pw = req.password.clone();
    let hash = admin.password_hash.clone();
    let valid = tokio::task::spawn_blocking(move || password::verify_password(&pw, &hash))
        .await
        .map_err(|_| ApiError::Internal("password verification task failed".into()))?
        .map_err(|_| ApiError::Internal("password hashing error".into()))?;

    if !valid {
        return Err(ApiError::BadRequest("incorrect password".into()));
    }

    // Delete all passkeys
    admin_passkeys::Entity::delete_many()
        .filter(admin_passkeys::Column::AdminId.eq(admin.id))
        .exec(&*state.db)
        .await
        .map_err(db_err)?;

    // Disable TOTP
    let mut active: admin_accounts::ActiveModel = admin.clone().into();
    active.totp_secret = Set(None);
    active.totp_enabled = Set(false);
    active.updated_at = Set(chrono::Utc::now().fixed_offset());
    active.update(&*state.db).await.map_err(db_err)?;

    // Delete recovery codes
    admin_recovery_codes::Entity::delete_many()
        .filter(admin_recovery_codes::Column::AdminId.eq(admin.id))
        .exec(&*state.db)
        .await
        .map_err(db_err)?;

    Ok(Json(serde_json::json!({ "reset": true })))
}

// ===========================================================================
// 1. Dashboard
// ===========================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardStats {
    total_users: i64,
    total_threads: i64,
    total_clubs: i64,
    pending_reports: i64,
    pending_appeals: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentReport {
    id: Uuid,
    reporter_id: Uuid,
    reporter_name: String,
    content_type: String,
    content_id: Uuid,
    reason: String,
    status: String,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentAction {
    id: Uuid,
    admin_id: Uuid,
    admin_name: String,
    action_type: String,
    target_type: String,
    target_id: Uuid,
    reason: Option<String>,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardResponse {
    stats: DashboardStats,
    recent_reports: Vec<RecentReport>,
    recent_actions: Vec<RecentAction>,
}

/// GET /admin/dashboard
async fn admin_dashboard(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<DashboardResponse>, ApiError> {
    require_admin(&jar, &state).await?;

    // Stats counts via a single query
    let stats_row = state
        .db
        .query_one(Statement::from_string(
            DatabaseBackend::Postgres,
            r"SELECT
                (SELECT COUNT(*)::bigint FROM users WHERE deleted_at IS NULL) AS total_users,
                (SELECT COUNT(*)::bigint FROM threads WHERE deleted_at IS NULL) AS total_threads,
                (SELECT COUNT(*)::bigint FROM clubs) AS total_clubs,
                (SELECT COUNT(*)::bigint FROM content_reports WHERE status = 'pending') AS pending_reports,
                (SELECT COUNT(*)::bigint FROM moderation_appeals WHERE status = 'pending') AS pending_appeals
            ",
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::Internal("stats query returned no rows".into()))?;

    let stats = DashboardStats {
        total_users: stats_row.try_get_by_index(0).map_err(db_err)?,
        total_threads: stats_row.try_get_by_index(1).map_err(db_err)?,
        total_clubs: stats_row.try_get_by_index(2).map_err(db_err)?,
        pending_reports: stats_row.try_get_by_index(3).map_err(db_err)?,
        pending_appeals: stats_row.try_get_by_index(4).map_err(db_err)?,
    };

    // Recent reports with reporter name
    let report_rows = state
        .db
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            r"SELECT cr.id, cr.reporter_id, u.name, cr.content_type, cr.content_id,
                     cr.reason, cr.status, cr.created_at
              FROM content_reports cr
              LEFT JOIN users u ON u.id = cr.reporter_id
              ORDER BY cr.created_at DESC
              LIMIT 10",
        ))
        .await
        .map_err(db_err)?;

    let recent_reports: Vec<RecentReport> = report_rows
        .iter()
        .filter_map(|r| {
            Some(RecentReport {
                id: r.try_get_by_index(0).ok()?,
                reporter_id: r.try_get_by_index(1).ok()?,
                reporter_name: r
                    .try_get_by_index::<Option<String>>(2)
                    .ok()?
                    .unwrap_or_default(),
                content_type: r.try_get_by_index(3).ok()?,
                content_id: r.try_get_by_index(4).ok()?,
                reason: r.try_get_by_index(5).ok()?,
                status: r.try_get_by_index(6).ok()?,
                created_at: r
                    .try_get_by_index::<chrono::DateTime<chrono::FixedOffset>>(7)
                    .ok()?
                    .to_rfc3339(),
            })
        })
        .collect();

    // Recent moderation actions with admin name
    let action_rows = state
        .db
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            r"SELECT ma.id, ma.admin_id, COALESCE(u.name, aa.name, 'system') AS admin_name,
                     ma.action_type, ma.target_type, ma.target_id, ma.reason, ma.created_at
              FROM moderation_actions ma
              LEFT JOIN users u ON u.id = ma.admin_id
              LEFT JOIN admin_accounts aa ON aa.id = ma.admin_id
              ORDER BY ma.created_at DESC
              LIMIT 10",
        ))
        .await
        .map_err(db_err)?;

    let recent_actions: Vec<RecentAction> = action_rows
        .iter()
        .filter_map(|r| {
            Some(RecentAction {
                id: r.try_get_by_index(0).ok()?,
                admin_id: r.try_get_by_index(1).ok()?,
                admin_name: r
                    .try_get_by_index::<Option<String>>(2)
                    .ok()?
                    .unwrap_or_default(),
                action_type: action_type_for_api(&r.try_get_by_index::<String>(3).ok()?),
                target_type: r.try_get_by_index(4).ok()?,
                target_id: r.try_get_by_index(5).ok()?,
                reason: r.try_get_by_index(6).ok()?,
                created_at: r
                    .try_get_by_index::<chrono::DateTime<chrono::FixedOffset>>(7)
                    .ok()?
                    .to_rfc3339(),
            })
        })
        .collect();

    Ok(Json(DashboardResponse {
        stats,
        recent_reports,
        recent_actions,
    }))
}

// ===========================================================================
// 2. Admin Users
// ===========================================================================

// --- List users ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminUsersListParams {
    search: Option<String>,
    role: Option<String>,
    #[serde(default = "default_page")]
    page: i64,
    #[serde(default = "default_limit")]
    limit: i64,
}

const fn default_page() -> i64 {
    1
}
const fn default_limit() -> i64 {
    20
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminUserListItem {
    id: Uuid,
    email: Option<String>,
    username: String,
    name: String,
    avatar_url: Option<String>,
    role: String,
    identity_verified: bool,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminUsersListResponse {
    items: Vec<AdminUserListItem>,
    total: i64,
}

/// GET /admin/users
async fn admin_list_users(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(params): Query<AdminUsersListParams>,
) -> Result<Json<AdminUsersListResponse>, ApiError> {
    require_admin(&jar, &state).await?;

    let limit = params.limit.clamp(1, 100);
    let page = params.page.max(1);
    let offset = (page - 1) * limit;

    // Build dynamic WHERE clauses
    let mut conditions = vec!["deleted_at IS NULL".to_string()];
    let mut values: Vec<sea_orm::Value> = Vec::new();
    let mut param_idx = 1u32;

    if let Some(ref search) = params.search {
        conditions.push(format!(
            "(username ILIKE ${param_idx} OR name ILIKE ${param_idx} OR email ILIKE ${param_idx})"
        ));
        values.push(format!("%{search}%").into());
        param_idx += 1;
    }

    if let Some(ref role) = params.role {
        conditions.push(format!("role = ${param_idx}"));
        values.push(role.clone().into());
        param_idx += 1;
    }

    let where_clause = conditions.join(" AND ");

    // Count
    let count_sql = format!("SELECT COUNT(*)::bigint FROM users WHERE {where_clause}");
    let total: i64 = state
        .db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            &count_sql,
            values.clone(),
        ))
        .await
        .map_err(db_err)?
        .and_then(|r| r.try_get_by_index(0).ok())
        .unwrap_or(0);

    // Data
    let data_sql = format!(
        "SELECT id, email, username, name, avatar_url, role, identity_verified, created_at
         FROM users WHERE {where_clause}
         ORDER BY created_at DESC
         LIMIT ${param_idx} OFFSET ${}",
        param_idx + 1
    );
    let mut data_values = values;
    data_values.push(limit.into());
    data_values.push(offset.into());

    let rows = state
        .db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            &data_sql,
            data_values,
        ))
        .await
        .map_err(db_err)?;

    let items: Vec<AdminUserListItem> = rows
        .iter()
        .filter_map(|r| {
            Some(AdminUserListItem {
                id: r.try_get_by_index(0).ok()?,
                email: r.try_get_by_index(1).ok()?,
                username: r.try_get_by_index(2).ok()?,
                name: r.try_get_by_index(3).ok()?,
                avatar_url: r.try_get_by_index(4).ok()?,
                role: r.try_get_by_index(5).ok()?,
                identity_verified: r.try_get_by_index(6).ok()?,
                created_at: r
                    .try_get_by_index::<chrono::DateTime<chrono::FixedOffset>>(7)
                    .ok()?
                    .to_rfc3339(),
            })
        })
        .collect();

    Ok(Json(AdminUsersListResponse { items, total }))
}

// --- User detail ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SanctionItem {
    id: Uuid,
    sanction_type: String,
    reason: String,
    issued_by: Uuid,
    issued_by_name: Option<String>,
    issued_at: String,
    expires_at: Option<String>,
    revoked_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
struct AdminUserDetailResponse {
    id: Uuid,
    email: Option<String>,
    username: String,
    name: String,
    avatar_url: Option<String>,
    bio: Option<String>,
    role: String,
    institution_type: Option<String>,
    institution_name: Option<String>,
    identity_verified: bool,
    identity_level: String,
    identity_provider: Option<String>,
    verified_name: Option<String>,
    municipality_id: Option<Uuid>,
    locale: String,
    notification_replies: bool,
    notification_mentions: bool,
    notification_official: bool,
    onboarding_completed_at: Option<String>,
    created_at: String,
    updated_at: String,
    last_seen_at: Option<String>,
    thread_count: i64,
    comment_count: i64,
    sanctions: Vec<SanctionItem>,
}

/// GET /admin/users/{id}
async fn admin_get_user(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminUserDetailResponse>, ApiError> {
    require_admin(&jar, &state).await?;

    let user = UserRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    // Thread count
    let thread_count: i64 = state
        .db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT COUNT(*)::bigint FROM threads WHERE author_id = $1 AND deleted_at IS NULL",
            [id.into()],
        ))
        .await
        .map_err(db_err)?
        .and_then(|r| r.try_get_by_index(0).ok())
        .unwrap_or(0);

    // Comment count
    let comment_count: i64 = state
        .db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT COUNT(*)::bigint FROM comments WHERE author_id = $1 AND deleted_at IS NULL",
            [id.into()],
        ))
        .await
        .map_err(db_err)?
        .and_then(|r| r.try_get_by_index(0).ok())
        .unwrap_or(0);

    // Sanctions
    use eulesia_db::entities::user_sanctions;
    let sanctions_models = user_sanctions::Entity::find()
        .filter(user_sanctions::Column::UserId.eq(id))
        .order_by_desc(user_sanctions::Column::IssuedAt)
        .all(&*state.db)
        .await
        .map_err(db_err)?;

    let mut sanctions = Vec::with_capacity(sanctions_models.len());
    for s in sanctions_models {
        sanctions.push(sanction_model_to_item(&state.db, s).await?);
    }

    Ok(Json(AdminUserDetailResponse {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
        bio: user.bio,
        role: user.role,
        institution_type: user.institution_type,
        institution_name: user.institution_name,
        identity_verified: user.identity_verified,
        identity_level: user.identity_level,
        identity_provider: user.identity_provider,
        verified_name: user.verified_name,
        municipality_id: user.municipality_id,
        locale: user.locale,
        notification_replies: user.notification_replies,
        notification_mentions: user.notification_mentions,
        notification_official: user.notification_official,
        onboarding_completed_at: user.onboarding_completed_at.map(|t| t.to_rfc3339()),
        created_at: user.created_at.to_rfc3339(),
        updated_at: user.updated_at.to_rfc3339(),
        last_seen_at: user.last_seen_at.map(|t| t.to_rfc3339()),
        thread_count,
        comment_count,
        sanctions,
    }))
}

// --- Change user role ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeRoleRequest {
    role: String,
}

/// PATCH /admin/users/{id}/role
async fn admin_change_user_role(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
    Json(req): Json<ChangeRoleRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&jar, &state).await?;

    // Only allow setting to citizen or institution
    if req.role != "citizen" && req.role != "institution" {
        return Err(ApiError::BadRequest(
            "role must be 'citizen' or 'institution'".into(),
        ));
    }

    let user = UserRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    let mut am: eulesia_db::entities::users::ActiveModel = user.into();
    am.role = Set(req.role.clone());
    am.updated_at = Set(chrono::Utc::now().fixed_offset());
    am.update(&*state.db).await.map_err(db_err)?;

    Ok(Json(serde_json::json!({ "role": req.role })))
}

// --- Toggle identity verification ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyRequest {
    verified: bool,
}

/// PATCH /admin/users/{id}/verify
async fn admin_toggle_verify(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&jar, &state).await?;

    let user = UserRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    let mut am: eulesia_db::entities::users::ActiveModel = user.into();
    am.identity_verified = Set(req.verified);
    am.updated_at = Set(chrono::Utc::now().fixed_offset());
    am.update(&*state.db).await.map_err(db_err)?;

    Ok(Json(
        serde_json::json!({ "identityVerified": req.verified }),
    ))
}

// ===========================================================================
// 3. Announcements
// ===========================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnnouncementResponse {
    id: Uuid,
    title: String,
    message: String,
    #[serde(rename = "type")]
    announcement_type: String,
    active: bool,
    created_by: Option<Uuid>,
    created_by_name: Option<String>,
    created_at: String,
    expires_at: Option<String>,
}

async fn announcement_to_response(
    m: eulesia_db::entities::system_announcements::Model,
    db: &sea_orm::DatabaseConnection,
) -> AnnouncementResponse {
    let created_by_name = if let Some(uid) = m.created_by {
        actor_name_by_id(db, uid).await.ok().flatten()
    } else {
        None
    };
    AnnouncementResponse {
        id: m.id,
        title: m.title,
        message: m.message,
        announcement_type: m.announcement_type,
        active: m.active,
        created_by: m.created_by,
        created_by_name,
        created_at: m.created_at.to_rfc3339(),
        expires_at: m.expires_at.map(|t| t.to_rfc3339()),
    }
}

/// GET /admin/announcements -- list ALL announcements (admin only)
async fn admin_list_announcements(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<Vec<AnnouncementResponse>>, ApiError> {
    require_admin(&jar, &state).await?;

    use eulesia_db::entities::system_announcements;
    let all = system_announcements::Entity::find()
        .order_by_desc(system_announcements::Column::CreatedAt)
        .all(&*state.db)
        .await
        .map_err(db_err)?;

    let mut items = Vec::with_capacity(all.len());
    for a in all {
        items.push(announcement_to_response(a, &state.db).await);
    }
    Ok(Json(items))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAnnouncementRequest {
    title: String,
    message: String,
    #[serde(alias = "type", default = "default_announcement_type")]
    announcement_type: String,
    expires_at: Option<String>,
}

fn default_announcement_type() -> String {
    "info".into()
}

/// POST /admin/announcements
async fn admin_create_announcement(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<CreateAnnouncementRequest>,
) -> Result<Json<AnnouncementResponse>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    if req.title.trim().is_empty() || req.message.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "title and message are required".into(),
        ));
    }

    let valid_types = ["info", "warning", "success", "error"];
    if !valid_types.contains(&req.announcement_type.as_str()) {
        return Err(ApiError::BadRequest(
            "type must be one of: info, warning, success, error".into(),
        ));
    }

    let expires_at = req
        .expires_at
        .as_deref()
        .map(|s| parse_api_datetime(s, "expiresAt"))
        .transpose()?;

    let id = new_id();
    let now = chrono::Utc::now().fixed_offset();

    use eulesia_db::entities::system_announcements;
    let model = system_announcements::ActiveModel {
        id: Set(id),
        title: Set(req.title.clone()),
        message: Set(req.message.clone()),
        announcement_type: Set(req.announcement_type.clone()),
        active: Set(true),
        created_by: Set(Some(admin.id)),
        created_at: Set(now),
        expires_at: Set(expires_at),
    };

    let inserted = model.insert(&*state.db).await.map_err(db_err)?;
    Ok(Json(announcement_to_response(inserted, &state.db).await))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleAnnouncementRequest {
    active: bool,
}

/// PATCH /admin/announcements/{id}
async fn admin_toggle_announcement(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
    Json(req): Json<ToggleAnnouncementRequest>,
) -> Result<Json<AnnouncementResponse>, ApiError> {
    require_admin(&jar, &state).await?;

    use eulesia_db::entities::system_announcements;
    let existing = system_announcements::Entity::find_by_id(id)
        .one(&*state.db)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("announcement not found".into()))?;

    let mut am: system_announcements::ActiveModel = existing.into();
    am.active = Set(req.active);
    let updated = am.update(&*state.db).await.map_err(db_err)?;

    Ok(Json(announcement_to_response(updated, &state.db).await))
}

/// DELETE /admin/announcements/{id}
async fn admin_delete_announcement(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&jar, &state).await?;

    use eulesia_db::entities::system_announcements;
    let result = system_announcements::Entity::delete_by_id(id)
        .exec(&*state.db)
        .await
        .map_err(db_err)?;

    if result.rows_affected == 0 {
        return Err(ApiError::NotFound("announcement not found".into()));
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ===========================================================================
// 4. Settings
// ===========================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SiteSettingsResponse {
    registration_open: bool,
}

/// GET /admin/settings
async fn admin_get_settings(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<SiteSettingsResponse>, ApiError> {
    require_admin(&jar, &state).await?;

    use eulesia_db::entities::site_settings;
    let row = site_settings::Entity::find_by_id("registrationOpen")
        .one(&*state.db)
        .await
        .map_err(db_err)?;

    let registration_open = row.is_none_or(|r| r.value == "true");

    Ok(Json(SiteSettingsResponse { registration_open }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSiteSettingsRequest {
    registration_open: bool,
}

/// PATCH /admin/settings
async fn admin_update_settings(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<UpdateSiteSettingsRequest>,
) -> Result<Json<SiteSettingsResponse>, ApiError> {
    require_admin(&jar, &state).await?;

    let now = chrono::Utc::now().fixed_offset();
    let value = if req.registration_open {
        "true"
    } else {
        "false"
    };

    state
        .db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"INSERT INTO site_settings (key, value, updated_at)
              VALUES ('registrationOpen', $1, $2)
              ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2",
            [value.into(), now.into()],
        ))
        .await
        .map_err(db_err)?;

    Ok(Json(SiteSettingsResponse {
        registration_open: req.registration_open,
    }))
}

// ===========================================================================
// 5. Invites
// ===========================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateInvitesRequest {
    count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InviteCodeResponse {
    id: Uuid,
    code: String,
    created_at: String,
}

/// POST /admin/invites/generate
async fn admin_generate_invites(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<GenerateInvitesRequest>,
) -> Result<Json<Vec<InviteCodeResponse>>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    if req.count == 0 || req.count > 50 {
        return Err(ApiError::BadRequest(
            "count must be between 1 and 50".into(),
        ));
    }

    let now = chrono::Utc::now().fixed_offset();
    let mut result = Vec::with_capacity(req.count as usize);

    for _ in 0..req.count {
        let id = new_id();
        let code = generate_invite_code();

        state
            .db
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r"INSERT INTO invite_codes (id, code, created_by, created_at)
                  VALUES ($1, $2, $3, $4)",
                [id.into(), code.clone().into(), admin.id.into(), now.into()],
            ))
            .await
            .map_err(db_err)?;

        result.push(InviteCodeResponse {
            id,
            code,
            created_at: now.to_rfc3339(),
        });
    }

    Ok(Json(result))
}

fn generate_invite_code() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    (0..12)
        .map(|_| {
            let idx = rng.random_range(0..36u8);
            if idx < 10 {
                (b'0' + idx) as char
            } else {
                (b'a' + idx - 10) as char
            }
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InviteCodeListItem {
    id: Uuid,
    code: String,
    status: String,
    created_by: Option<Uuid>,
    used_by: Option<UsedByInfo>,
    used_at: Option<String>,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsedByInfo {
    id: Uuid,
    name: String,
}

/// GET /admin/invites
async fn admin_list_invites(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<Vec<InviteCodeListItem>>, ApiError> {
    require_admin(&jar, &state).await?;

    let rows = state
        .db
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            r"SELECT ic.id, ic.code, ic.status, ic.created_by, ic.used_by, u.name, ic.used_at, ic.created_at
              FROM invite_codes ic
              LEFT JOIN users u ON u.id = ic.used_by
              ORDER BY ic.created_at DESC",
        ))
        .await
        .map_err(db_err)?;

    let items: Vec<InviteCodeListItem> = rows
        .iter()
        .filter_map(|r| {
            let used_by_id: Option<Uuid> = r.try_get_by_index(4).ok()?;
            let used_by_name: Option<String> = r.try_get_by_index(5).ok()?;
            let used_by = match (used_by_id, used_by_name) {
                (Some(id), Some(name)) => Some(UsedByInfo { id, name }),
                _ => None,
            };
            Some(InviteCodeListItem {
                id: r.try_get_by_index(0).ok()?,
                code: r.try_get_by_index(1).ok()?,
                status: r.try_get_by_index::<String>(2).ok()?,
                created_by: r.try_get_by_index(3).ok()?,
                used_by,
                used_at: r
                    .try_get_by_index::<Option<chrono::DateTime<chrono::FixedOffset>>>(6)
                    .ok()?
                    .map(|t| t.to_rfc3339()),
                created_at: r
                    .try_get_by_index::<chrono::DateTime<chrono::FixedOffset>>(7)
                    .ok()?
                    .to_rfc3339(),
            })
        })
        .collect();

    Ok(Json(items))
}

// ===========================================================================
// Reports, Appeals & Sanctions
// ===========================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminReportsParams {
    page: Option<u64>,
    limit: Option<u64>,
    status: Option<String>,
    reason: Option<String>,
    content_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminReportContentPreview {
    title: Option<String>,
    content: Option<String>,
    name: Option<String>,
    author_id: Option<Uuid>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminReportListItem {
    id: Uuid,
    content_type: String,
    content_id: Uuid,
    reason: String,
    description: Option<String>,
    status: String,
    created_at: String,
    resolved_at: Option<String>,
    reporter_name: String,
    reporter_user_id: Uuid,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminReportDetailResponse {
    id: Uuid,
    content_type: String,
    content_id: Uuid,
    reason: String,
    description: Option<String>,
    status: String,
    created_at: String,
    resolved_at: Option<String>,
    reporter_name: String,
    reporter_user_id: Uuid,
    assigned_to: Option<Uuid>,
    content: Option<AdminReportContentPreview>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminReportListResponse {
    items: Vec<AdminReportListItem>,
    total: u64,
    page: u64,
    limit: u64,
    has_more: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAdminReportRequest {
    status: ReportStatus,
    reason: Option<String>,
}

async fn load_report_content_preview(
    db: &sea_orm::DatabaseConnection,
    content_type: &str,
    content_id: Uuid,
) -> Result<Option<AdminReportContentPreview>, ApiError> {
    let statement = match content_type {
        "thread" => Some(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT title, content, author_id FROM threads WHERE id = $1",
            [content_id.into()],
        )),
        "comment" => Some(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT content, author_id FROM comments WHERE id = $1",
            [content_id.into()],
        )),
        "club" => Some(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT name, description, creator_id FROM clubs WHERE id = $1",
            [content_id.into()],
        )),
        "user" => Some(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT name, bio FROM users WHERE id = $1",
            [content_id.into()],
        )),
        _ => None,
    };

    let Some(statement) = statement else {
        return Ok(None);
    };

    let row = db.query_one(statement).await.map_err(db_err)?;

    Ok(match content_type {
        "thread" => row.map(|r| AdminReportContentPreview {
            title: r.try_get_by_index(0).ok(),
            content: r.try_get_by_index(1).ok(),
            name: None,
            author_id: r.try_get_by_index(2).ok(),
        }),
        "comment" => row.map(|r| AdminReportContentPreview {
            title: None,
            content: r.try_get_by_index(0).ok(),
            name: None,
            author_id: r.try_get_by_index(1).ok(),
        }),
        "club" => row.map(|r| AdminReportContentPreview {
            title: None,
            content: r.try_get_by_index(1).ok(),
            name: r.try_get_by_index(0).ok(),
            author_id: r.try_get_by_index(2).ok(),
        }),
        "user" => row.map(|r| AdminReportContentPreview {
            title: None,
            content: r.try_get_by_index(1).ok(),
            name: r.try_get_by_index(0).ok(),
            author_id: Some(content_id),
        }),
        _ => None,
    })
}

/// GET /admin/reports
async fn admin_list_reports(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(params): Query<AdminReportsParams>,
) -> Result<Json<AdminReportListResponse>, ApiError> {
    require_admin(&jar, &state).await?;

    let (page, limit, offset) = paginate(params.page, params.limit, 20, 100);

    let count_sql = r"SELECT COUNT(*)::bigint
          FROM content_reports cr
          WHERE ($1::text IS NULL OR cr.status = $1)
            AND ($2::text IS NULL OR cr.reason = $2)
            AND ($3::text IS NULL OR cr.content_type = $3)";
    let total = state
        .db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            count_sql,
            [
                params.status.clone().into(),
                params.reason.clone().into(),
                params.content_type.clone().into(),
            ],
        ))
        .await
        .map_err(db_err)?
        .and_then(|r| r.try_get_by_index::<i64>(0).ok())
        .unwrap_or(0)
        .try_into()
        .unwrap_or(0);

    let data_sql = r"SELECT cr.id, cr.content_type, cr.content_id, cr.reason, cr.description,
                 cr.status, cr.created_at, cr.resolved_at, cr.reporter_id,
                 COALESCE(u.name, 'Deleted user') AS reporter_name
          FROM content_reports cr
          LEFT JOIN users u ON u.id = cr.reporter_id
          WHERE ($1::text IS NULL OR cr.status = $1)
            AND ($2::text IS NULL OR cr.reason = $2)
            AND ($3::text IS NULL OR cr.content_type = $3)
          ORDER BY cr.created_at DESC
          OFFSET $4 LIMIT $5";

    let rows = state
        .db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            data_sql,
            [
                params.status.into(),
                params.reason.into(),
                params.content_type.into(),
                pagination_sql_value(offset).into(),
                pagination_sql_value(limit).into(),
            ],
        ))
        .await
        .map_err(db_err)?;

    let items = rows
        .iter()
        .filter_map(|r| {
            Some(AdminReportListItem {
                id: r.try_get_by_index(0).ok()?,
                content_type: r.try_get_by_index(1).ok()?,
                content_id: r.try_get_by_index(2).ok()?,
                reason: r.try_get_by_index(3).ok()?,
                description: r.try_get_by_index(4).ok()?,
                status: r.try_get_by_index(5).ok()?,
                created_at: r
                    .try_get_by_index::<chrono::DateTime<chrono::FixedOffset>>(6)
                    .ok()?
                    .to_rfc3339(),
                resolved_at: r
                    .try_get_by_index::<Option<chrono::DateTime<chrono::FixedOffset>>>(7)
                    .ok()?
                    .map(|t| t.to_rfc3339()),
                reporter_user_id: r.try_get_by_index(8).ok()?,
                reporter_name: r.try_get_by_index(9).ok()?,
            })
        })
        .collect();

    Ok(Json(AdminReportListResponse {
        items,
        total,
        page,
        limit,
        has_more: has_more(total, offset, limit),
    }))
}

/// GET /admin/reports/{id}
async fn admin_get_report(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminReportDetailResponse>, ApiError> {
    require_admin(&jar, &state).await?;

    let row = state
        .db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"SELECT cr.id, cr.content_type, cr.content_id, cr.reason, cr.description,
                     cr.status, cr.created_at, cr.resolved_at, cr.reporter_id,
                     COALESCE(u.name, 'Deleted user') AS reporter_name, cr.assigned_to
              FROM content_reports cr
              LEFT JOIN users u ON u.id = cr.reporter_id
              WHERE cr.id = $1",
            [id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("report not found".into()))?;

    let content_type: String = row.try_get_by_index(1).map_err(db_err)?;
    let content_id: Uuid = row.try_get_by_index(2).map_err(db_err)?;
    let content = load_report_content_preview(&state.db, &content_type, content_id).await?;

    Ok(Json(AdminReportDetailResponse {
        id: row.try_get_by_index(0).map_err(db_err)?,
        content_type,
        content_id,
        reason: row.try_get_by_index(3).map_err(db_err)?,
        description: row.try_get_by_index(4).map_err(db_err)?,
        status: row.try_get_by_index(5).map_err(db_err)?,
        created_at: row
            .try_get_by_index::<chrono::DateTime<chrono::FixedOffset>>(6)
            .map_err(db_err)?
            .to_rfc3339(),
        resolved_at: row
            .try_get_by_index::<Option<chrono::DateTime<chrono::FixedOffset>>>(7)
            .map_err(db_err)?
            .map(|t| t.to_rfc3339()),
        reporter_user_id: row.try_get_by_index(8).map_err(db_err)?,
        reporter_name: row.try_get_by_index(9).map_err(db_err)?,
        assigned_to: row.try_get_by_index(10).map_err(db_err)?,
        content,
    }))
}

/// PATCH /admin/reports/{id}
async fn admin_update_report(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateAdminReportRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    use eulesia_db::entities::content_reports;
    let existing = content_reports::Entity::find_by_id(id)
        .one(&*state.db)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("report not found".into()))?;

    let mut am: content_reports::ActiveModel = existing.into();
    am.status = Set(req.status.as_str().to_owned());
    am.assigned_to = Set(Some(admin.id));
    am.resolved_at = Set(
        if matches!(req.status, ReportStatus::Resolved | ReportStatus::Dismissed) {
            Some(chrono::Utc::now().fixed_offset())
        } else {
            None
        },
    );
    let updated = am.update(&*state.db).await.map_err(db_err)?;

    let logged_action = match req.status {
        ReportStatus::Resolved => Some("report_resolved"),
        ReportStatus::Dismissed => Some("report_dismissed"),
        _ => None,
    };

    if let Some(action_type) = logged_action {
        state
            .db
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r"INSERT INTO moderation_actions (id, admin_id, action_type, target_type, target_id, reason, created_at)
                  VALUES ($1, $2, $3, 'report', $4, $5, NOW())",
                [
                    new_id().into(),
                    admin.id.into(),
                    action_type.into(),
                    updated.id.into(),
                    req.reason.into(),
                ],
            ))
            .await
            .map_err(db_err)?;
    }

    Ok(Json(serde_json::json!({
        "id": updated.id,
        "status": updated.status,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminAppealsParams {
    page: Option<u64>,
    limit: Option<u64>,
    status: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminAppealItem {
    id: Uuid,
    reason: String,
    status: String,
    admin_response: Option<String>,
    created_at: String,
    responded_at: Option<String>,
    sanction_id: Option<Uuid>,
    report_id: Option<Uuid>,
    action_id: Option<Uuid>,
    user_id: Uuid,
    user_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminAppealsResponse {
    items: Vec<AdminAppealItem>,
    total: u64,
    page: u64,
    limit: u64,
    has_more: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveAdminAppealRequest {
    admin_response: String,
    status: AppealStatus,
}

/// GET /admin/appeals
async fn admin_list_appeals(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(params): Query<AdminAppealsParams>,
) -> Result<Json<AdminAppealsResponse>, ApiError> {
    require_admin(&jar, &state).await?;

    let (page, limit, offset) = paginate(params.page, params.limit, 20, 100);

    let count_sql = r"SELECT COUNT(*)::bigint
          FROM moderation_appeals ma
          WHERE ($1::text IS NULL OR ma.status = $1)";
    let total = state
        .db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            count_sql,
            [params.status.clone().into()],
        ))
        .await
        .map_err(db_err)?
        .and_then(|r| r.try_get_by_index::<i64>(0).ok())
        .unwrap_or(0)
        .try_into()
        .unwrap_or(0);

    let data_sql = r"SELECT ma.id, ma.reason, ma.status, ma.admin_response, ma.created_at,
                 ma.responded_at, ma.sanction_id, ma.report_id, ma.action_id,
                 ma.user_id, COALESCE(u.name, 'Deleted user') AS user_name
          FROM moderation_appeals ma
          LEFT JOIN users u ON u.id = ma.user_id
          WHERE ($1::text IS NULL OR ma.status = $1)
          ORDER BY ma.created_at DESC
          OFFSET $2 LIMIT $3";

    let rows = state
        .db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            data_sql,
            [
                params.status.into(),
                pagination_sql_value(offset).into(),
                pagination_sql_value(limit).into(),
            ],
        ))
        .await
        .map_err(db_err)?;

    let items = rows
        .iter()
        .filter_map(|r| {
            Some(AdminAppealItem {
                id: r.try_get_by_index(0).ok()?,
                reason: r.try_get_by_index(1).ok()?,
                status: r.try_get_by_index(2).ok()?,
                admin_response: r.try_get_by_index(3).ok()?,
                created_at: r
                    .try_get_by_index::<chrono::DateTime<chrono::FixedOffset>>(4)
                    .ok()?
                    .to_rfc3339(),
                responded_at: r
                    .try_get_by_index::<Option<chrono::DateTime<chrono::FixedOffset>>>(5)
                    .ok()?
                    .map(|t| t.to_rfc3339()),
                sanction_id: r.try_get_by_index(6).ok()?,
                report_id: r.try_get_by_index(7).ok()?,
                action_id: r.try_get_by_index(8).ok()?,
                user_id: r.try_get_by_index(9).ok()?,
                user_name: r.try_get_by_index(10).ok()?,
            })
        })
        .collect();

    Ok(Json(AdminAppealsResponse {
        items,
        total,
        page,
        limit,
        has_more: has_more(total, offset, limit),
    }))
}

/// PATCH /admin/appeals/{id}
async fn admin_respond_appeal(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
    Json(req): Json<ResolveAdminAppealRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    if req.admin_response.trim().is_empty() {
        return Err(ApiError::BadRequest("adminResponse is required".into()));
    }
    if matches!(req.status, AppealStatus::Pending) {
        return Err(ApiError::BadRequest(
            "status must be accepted or rejected".into(),
        ));
    }

    let appeal = AppealRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("appeal not found".into()))?;

    let sanction_id_to_revoke = if req.status == AppealStatus::Accepted {
        if let Some(sanction_id) = appeal.sanction_id {
            let sanction = SanctionRepo::find_by_id(&state.db, sanction_id)
                .await
                .map_err(db_err)?
                .ok_or_else(|| ApiError::NotFound("sanction not found".into()))?;

            if sanction.revoked_at.is_none() {
                Some(sanction_id)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let status = req.status.as_str().to_owned();
    let admin_response = req.admin_response;

    let txn = state.db.begin().await.map_err(db_err)?;

    if let Some(sanction_id) = sanction_id_to_revoke {
        txn.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"UPDATE user_sanctions
              SET revoked_at = NOW(), revoked_by = $2
              WHERE id = $1 AND revoked_at IS NULL",
            [sanction_id.into(), admin.id.into()],
        ))
        .await
        .map_err(db_err)?;
    }

    let result = txn
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"UPDATE moderation_appeals
              SET admin_response = $2, responded_by = $3, responded_at = NOW(), status = $4
              WHERE id = $1",
            [
                id.into(),
                admin_response.into(),
                admin.id.into(),
                status.clone().into(),
            ],
        ))
        .await
        .map_err(db_err)?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("appeal not found".into()));
    }

    txn.commit().await.map_err(db_err)?;

    Ok(Json(serde_json::json!({
        "id": id,
        "status": status,
    })))
}

async fn sanction_model_to_item(
    db: &sea_orm::DatabaseConnection,
    sanction: eulesia_db::entities::user_sanctions::Model,
) -> Result<SanctionItem, ApiError> {
    Ok(SanctionItem {
        id: sanction.id,
        sanction_type: sanction.sanction_type,
        reason: sanction.reason.unwrap_or_default(),
        issued_by: sanction.issued_by,
        issued_by_name: actor_name_by_id(db, sanction.issued_by)
            .await
            .map_err(db_err)?,
        issued_at: sanction.issued_at.to_rfc3339(),
        expires_at: sanction.expires_at.map(|t| t.to_rfc3339()),
        revoked_at: sanction.revoked_at.map(|t| t.to_rfc3339()),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueAdminSanctionRequest {
    sanction_type: SanctionType,
    reason: Option<String>,
    expires_at: Option<String>,
}

/// POST /admin/users/{id}/sanction
async fn admin_issue_sanction(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(user_id): Path<Uuid>,
    Json(req): Json<IssueAdminSanctionRequest>,
) -> Result<Json<SanctionItem>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    UserRepo::find_by_id(&state.db, user_id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    let reason = req
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| ApiError::BadRequest("reason is required".into()))?;

    let expires_at = req
        .expires_at
        .as_deref()
        .map(|value| parse_api_datetime(value, "expiresAt"))
        .transpose()?;

    let sanction = SanctionRepo::create(
        &state.db,
        eulesia_db::entities::user_sanctions::ActiveModel {
            id: Set(new_id()),
            user_id: Set(user_id),
            sanction_type: Set(req.sanction_type.as_str().to_owned()),
            reason: Set(Some(reason.clone())),
            issued_by: Set(admin.id),
            issued_at: Set(chrono::Utc::now().fixed_offset()),
            expires_at: Set(expires_at),
            ..Default::default()
        },
    )
    .await
    .map_err(db_err)?;

    let action_type = match req.sanction_type {
        SanctionType::Warning => "user_warned",
        SanctionType::Suspension => "user_suspended",
        SanctionType::Ban => "user_banned",
    };

    state
        .db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"INSERT INTO moderation_actions (id, admin_id, action_type, target_type, target_id, reason, created_at)
              VALUES ($1, $2, $3, 'user', $4, $5, NOW())",
            [
                new_id().into(),
                admin.id.into(),
                action_type.into(),
                user_id.into(),
                Some(reason).into(),
            ],
        ))
        .await
        .map_err(db_err)?;

    Ok(Json(sanction_model_to_item(&state.db, sanction).await?))
}

/// GET /admin/users/{id}/sanctions
async fn admin_user_sanctions(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Vec<SanctionItem>>, ApiError> {
    require_admin(&jar, &state).await?;

    use eulesia_db::entities::user_sanctions;
    let models = user_sanctions::Entity::find()
        .filter(user_sanctions::Column::UserId.eq(user_id))
        .order_by_desc(user_sanctions::Column::IssuedAt)
        .all(&*state.db)
        .await
        .map_err(db_err)?;

    let mut items = Vec::with_capacity(models.len());
    for sanction in models {
        items.push(sanction_model_to_item(&state.db, sanction).await?);
    }

    Ok(Json(items))
}

/// DELETE /admin/sanctions/{id}
async fn admin_revoke_sanction(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    let sanction = SanctionRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("sanction not found".into()))?;

    SanctionRepo::revoke(&state.db, id, admin.id)
        .await
        .map_err(db_err)?;

    let action_type = if sanction.sanction_type == "ban" {
        "user_unbanned"
    } else {
        "sanction_revoked"
    };

    state
        .db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"INSERT INTO moderation_actions (id, admin_id, action_type, target_type, target_id, reason, created_at)
              VALUES ($1, $2, $3, 'user', $4, $5, NOW())",
            [
                new_id().into(),
                admin.id.into(),
                action_type.into(),
                sanction.user_id.into(),
                sanction.reason.into(),
            ],
        ))
        .await
        .map_err(db_err)?;

    Ok(Json(serde_json::json!({ "revoked": true })))
}

// ===========================================================================
// Modlog & Transparency
// ===========================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModlogParams {
    page: Option<u64>,
    limit: Option<u64>,
    action_type: Option<String>,
    admin_id: Option<Uuid>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModlogEntry {
    id: Uuid,
    admin_id: Uuid,
    admin_name: String,
    action_type: String,
    target_type: String,
    target_id: Uuid,
    reason: Option<String>,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModlogResponse {
    items: Vec<ModlogEntry>,
    total: u64,
    page: u64,
    limit: u64,
    has_more: bool,
}

/// GET /admin/modlog — paginated moderation action log (admin-only).
async fn admin_modlog(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(params): Query<ModlogParams>,
) -> Result<Json<ModlogResponse>, ApiError> {
    require_admin(&jar, &state).await?;

    let (page, limit, offset) = paginate(params.page, params.limit, 30, 200);
    let action_type = params.action_type.clone();
    let admin_id = params.admin_id;

    let count_sql = r"SELECT COUNT(*)::bigint
          FROM moderation_actions ma
          WHERE ($1::text IS NULL OR
                 CASE ma.action_type
                   WHEN 'content_delete' THEN 'content_removed'
                   WHEN 'content_restore' THEN 'content_restored'
                   ELSE ma.action_type
                 END = $1)
            AND ($2::uuid IS NULL OR ma.admin_id = $2)";
    let total = state
        .db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            count_sql,
            [action_type.clone().into(), admin_id.into()],
        ))
        .await
        .map_err(db_err)?
        .and_then(|r| r.try_get_by_index::<i64>(0).ok())
        .unwrap_or(0)
        .try_into()
        .unwrap_or(0);

    let data_sql = r"SELECT ma.id, ma.admin_id, COALESCE(u.name, aa.name, 'system') AS admin_name,
                 ma.action_type, ma.target_type, ma.target_id, ma.reason, ma.created_at
          FROM moderation_actions ma
          LEFT JOIN users u ON u.id = ma.admin_id
          LEFT JOIN admin_accounts aa ON aa.id = ma.admin_id
          WHERE ($1::text IS NULL OR
                 CASE ma.action_type
                   WHEN 'content_delete' THEN 'content_removed'
                   WHEN 'content_restore' THEN 'content_restored'
                   ELSE ma.action_type
                 END = $1)
            AND ($2::uuid IS NULL OR ma.admin_id = $2)
          ORDER BY ma.created_at DESC, ma.id DESC
          OFFSET $3 LIMIT $4";

    let rows = state
        .db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            data_sql,
            [
                action_type.into(),
                admin_id.into(),
                pagination_sql_value(offset).into(),
                pagination_sql_value(limit).into(),
            ],
        ))
        .await
        .map_err(db_err)?;

    let items: Vec<ModlogEntry> = rows
        .iter()
        .filter_map(|r| {
            Some(ModlogEntry {
                id: r.try_get_by_index(0).ok()?,
                admin_id: r.try_get_by_index(1).ok()?,
                admin_name: r.try_get_by_index::<String>(2).ok()?,
                action_type: action_type_for_api(&r.try_get_by_index::<String>(3).ok()?),
                target_type: r.try_get_by_index(4).ok()?,
                target_id: r.try_get_by_index(5).ok()?,
                reason: r.try_get_by_index::<Option<String>>(6).ok()?,
                created_at: r
                    .try_get_by_index::<chrono::DateTime<chrono::FixedOffset>>(7)
                    .ok()?
                    .to_rfc3339(),
            })
        })
        .collect();

    Ok(Json(ModlogResponse {
        items,
        total,
        page,
        limit,
        has_more: has_more(total, offset, limit),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransparencyParams {
    from: Option<String>,
    to: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencyActionCount {
    action_type: String,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencyStatusCount {
    status: String,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencyReasonCount {
    reason: String,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencyContentTypeCount {
    content_type: String,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencySanctionTypeCount {
    sanction_type: String,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencyPeriod {
    from: String,
    to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencyReports {
    by_status: Vec<TransparencyStatusCount>,
    by_reason: Vec<TransparencyReasonCount>,
    by_content_type: Vec<TransparencyContentTypeCount>,
    avg_response_time_hours: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencyActions {
    by_type: Vec<TransparencyActionCount>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencySanctions {
    by_type: Vec<TransparencySanctionTypeCount>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencyAppeals {
    by_status: Vec<TransparencyStatusCount>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransparencyResponse {
    period: TransparencyPeriod,
    reports: TransparencyReports,
    actions: TransparencyActions,
    sanctions: TransparencySanctions,
    appeals: TransparencyAppeals,
}

/// GET /admin/transparency — public-facing moderation transparency summary.
async fn admin_transparency(
    State(state): State<AppState>,
    Query(params): Query<TransparencyParams>,
) -> Result<Json<TransparencyResponse>, ApiError> {
    let to = params
        .to
        .as_deref()
        .map(|value| parse_api_datetime(value, "to"))
        .transpose()?
        .unwrap_or_else(|| chrono::Utc::now().fixed_offset());
    let from = params
        .from
        .as_deref()
        .map(|value| parse_api_datetime(value, "from"))
        .transpose()?
        .unwrap_or_else(|| to - chrono::Duration::days(30));

    let report_status_rows = state
        .db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"SELECT status, COUNT(*)::bigint
              FROM content_reports
              WHERE created_at >= $1 AND created_at <= $2
              GROUP BY status
              ORDER BY COUNT(*) DESC, status ASC",
            [from.into(), to.into()],
        ))
        .await
        .map_err(db_err)?;

    let report_reason_rows = state
        .db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"SELECT reason, COUNT(*)::bigint
              FROM content_reports
              WHERE created_at >= $1 AND created_at <= $2
              GROUP BY reason
              ORDER BY COUNT(*) DESC, reason ASC",
            [from.into(), to.into()],
        ))
        .await
        .map_err(db_err)?;

    let report_content_type_rows = state
        .db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"SELECT content_type, COUNT(*)::bigint
              FROM content_reports
              WHERE created_at >= $1 AND created_at <= $2
              GROUP BY content_type
              ORDER BY COUNT(*) DESC, content_type ASC",
            [from.into(), to.into()],
        ))
        .await
        .map_err(db_err)?;

    let avg_response_time_hours = state
        .db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0)
              FROM content_reports
              WHERE created_at >= $1 AND created_at <= $2
                AND resolved_at IS NOT NULL",
            [from.into(), to.into()],
        ))
        .await
        .map_err(db_err)?
        .and_then(|r| r.try_get_by_index::<Option<f64>>(0).ok())
        .flatten()
        .map(|value| (value * 10.0).round() / 10.0);

    let type_rows = state
        .db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"SELECT action_type, COUNT(*)::bigint AS cnt
              FROM moderation_actions
              WHERE created_at >= $1 AND created_at <= $2
              GROUP BY action_type
              ORDER BY cnt DESC, action_type ASC",
            [from.into(), to.into()],
        ))
        .await
        .map_err(db_err)?;

    let sanctions_by_type_rows = state
        .db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"SELECT sanction_type, COUNT(*)::bigint
              FROM user_sanctions
              WHERE issued_at >= $1 AND issued_at <= $2
              GROUP BY sanction_type
              ORDER BY COUNT(*) DESC, sanction_type ASC",
            [from.into(), to.into()],
        ))
        .await
        .map_err(db_err)?;

    let appeals_by_status_rows = state
        .db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"SELECT status, COUNT(*)::bigint
              FROM moderation_appeals
              WHERE created_at >= $1 AND created_at <= $2
              GROUP BY status
              ORDER BY COUNT(*) DESC, status ASC",
            [from.into(), to.into()],
        ))
        .await
        .map_err(db_err)?;

    let reports_by_status = report_status_rows
        .iter()
        .filter_map(|r| {
            Some(TransparencyStatusCount {
                status: r.try_get_by_index(0).ok()?,
                count: r.try_get_by_index(1).ok()?,
            })
        })
        .collect();

    let reports_by_reason = report_reason_rows
        .iter()
        .filter_map(|r| {
            Some(TransparencyReasonCount {
                reason: r.try_get_by_index(0).ok()?,
                count: r.try_get_by_index(1).ok()?,
            })
        })
        .collect();

    let reports_by_content_type = report_content_type_rows
        .iter()
        .filter_map(|r| {
            Some(TransparencyContentTypeCount {
                content_type: r.try_get_by_index(0).ok()?,
                count: r.try_get_by_index(1).ok()?,
            })
        })
        .collect();

    let mut action_counts = std::collections::BTreeMap::<String, i64>::new();
    for row in &type_rows {
        let raw_action_type: String = row.try_get_by_index(0).map_err(db_err)?;
        let count: i64 = row.try_get_by_index(1).map_err(db_err)?;
        *action_counts
            .entry(action_type_for_api(&raw_action_type))
            .or_insert(0) += count;
    }
    let mut actions_by_type: Vec<TransparencyActionCount> = action_counts
        .into_iter()
        .map(|(action_type, count)| TransparencyActionCount { action_type, count })
        .collect();
    actions_by_type.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.action_type.cmp(&right.action_type))
    });

    let sanctions_by_type = sanctions_by_type_rows
        .iter()
        .filter_map(|r| {
            Some(TransparencySanctionTypeCount {
                sanction_type: r.try_get_by_index(0).ok()?,
                count: r.try_get_by_index(1).ok()?,
            })
        })
        .collect();

    let appeals_by_status = appeals_by_status_rows
        .iter()
        .filter_map(|r| {
            Some(TransparencyStatusCount {
                status: r.try_get_by_index(0).ok()?,
                count: r.try_get_by_index(1).ok()?,
            })
        })
        .collect();

    Ok(Json(TransparencyResponse {
        period: TransparencyPeriod {
            from: from.to_rfc3339(),
            to: to.to_rfc3339(),
        },
        reports: TransparencyReports {
            by_status: reports_by_status,
            by_reason: reports_by_reason,
            by_content_type: reports_by_content_type,
            avg_response_time_hours,
        },
        actions: TransparencyActions {
            by_type: actions_by_type,
        },
        sanctions: TransparencySanctions {
            by_type: sanctions_by_type,
        },
        appeals: TransparencyAppeals {
            by_status: appeals_by_status,
        },
    }))
}

// ===========================================================================
// Content moderation (admin-authenticated)
// ===========================================================================

/// DELETE /admin/content/{type}/{id} — soft-delete content (thread or comment).
async fn admin_delete_content(
    State(state): State<AppState>,
    jar: CookieJar,
    Path((content_type, content_id)): Path<(String, Uuid)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    match content_type.as_str() {
        "thread" => {
            let thread = threads::Entity::find_by_id(content_id)
                .one(&*state.db)
                .await
                .map_err(db_err)?
                .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

            if thread.deleted_at.is_some() {
                return Err(ApiError::NotFound(
                    "thread not found or already deleted".into(),
                ));
            }

            let sync_search = should_sync_thread_search(&thread);
            let txn = state.db.begin().await.map_err(db_err)?;
            let result = txn
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "UPDATE threads SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
                    [content_id.into()],
                ))
                .await
                .map_err(db_err)?;

            if result.rows_affected() == 0 {
                return Err(ApiError::NotFound(
                    "thread not found or already deleted".into(),
                ));
            }

            write_moderation_action(
                &txn,
                admin.id,
                "content_removed",
                "thread",
                content_id,
                None,
            )
            .await
            .map_err(db_err)?;

            txn.commit().await.map_err(db_err)?;

            if sync_search {
                if let Err(e) = emit_event(
                    &*state.db,
                    "thread_deleted",
                    serde_json::json!({
                        "id": thread.id.to_string(),
                    }),
                )
                .await
                {
                    warn!(thread_id = %thread.id, error = %e, "failed to emit thread_deleted event");
                }
            }
        }
        "comment" => {
            let comment = comments::Entity::find_by_id(content_id)
                .one(&*state.db)
                .await
                .map_err(db_err)?
                .ok_or_else(|| ApiError::NotFound("comment not found".into()))?;

            if comment.deleted_at.is_some() {
                return Err(ApiError::NotFound(
                    "comment not found or already deleted".into(),
                ));
            }

            let txn = state.db.begin().await.map_err(db_err)?;
            let result = txn
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "UPDATE comments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
                    [content_id.into()],
                ))
                .await
                .map_err(db_err)?;

            if result.rows_affected() == 0 {
                return Err(ApiError::NotFound(
                    "comment not found or already deleted".into(),
                ));
            }

            txn.execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "UPDATE threads SET reply_count = reply_count - 1 WHERE id = $1",
                [comment.thread_id.into()],
            ))
            .await
            .map_err(db_err)?;

            write_moderation_action(
                &txn,
                admin.id,
                "content_removed",
                "comment",
                content_id,
                None,
            )
            .await
            .map_err(db_err)?;

            txn.commit().await.map_err(db_err)?;
        }
        _ => {
            return Err(ApiError::BadRequest(
                "type must be 'thread' or 'comment'".into(),
            ));
        }
    }

    Ok(Json(
        serde_json::json!({ "deleted": true, "type": content_type, "id": content_id }),
    ))
}

/// POST /admin/content/{type}/{id}/restore — un-delete content.
async fn admin_restore_content(
    State(state): State<AppState>,
    jar: CookieJar,
    Path((content_type, content_id)): Path<(String, Uuid)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let admin = require_admin(&jar, &state).await?;

    match content_type.as_str() {
        "thread" => {
            let thread = threads::Entity::find_by_id(content_id)
                .one(&*state.db)
                .await
                .map_err(db_err)?
                .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

            if thread.deleted_at.is_none() {
                return Err(ApiError::NotFound("thread not found or not deleted".into()));
            }

            let sync_search = should_sync_thread_search(&thread);
            let txn = state.db.begin().await.map_err(db_err)?;
            let result = txn
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "UPDATE threads SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL",
                    [content_id.into()],
                ))
                .await
                .map_err(db_err)?;

            if result.rows_affected() == 0 {
                return Err(ApiError::NotFound("thread not found or not deleted".into()));
            }

            write_moderation_action(
                &txn,
                admin.id,
                "content_restored",
                "thread",
                content_id,
                None,
            )
            .await
            .map_err(db_err)?;

            txn.commit().await.map_err(db_err)?;

            if sync_search {
                if let Err(e) =
                    emit_event(&*state.db, "thread_updated", thread_search_payload(&thread)).await
                {
                    warn!(thread_id = %thread.id, error = %e, "failed to emit thread_updated event");
                }
            }
        }
        "comment" => {
            let comment = comments::Entity::find_by_id(content_id)
                .one(&*state.db)
                .await
                .map_err(db_err)?
                .ok_or_else(|| ApiError::NotFound("comment not found".into()))?;

            if comment.deleted_at.is_none() {
                return Err(ApiError::NotFound(
                    "comment not found or not deleted".into(),
                ));
            }

            let txn = state.db.begin().await.map_err(db_err)?;
            let result = txn
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "UPDATE comments SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL",
                    [content_id.into()],
                ))
                .await
                .map_err(db_err)?;

            if result.rows_affected() == 0 {
                return Err(ApiError::NotFound(
                    "comment not found or not deleted".into(),
                ));
            }

            txn.execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "UPDATE threads SET reply_count = reply_count + 1 WHERE id = $1",
                [comment.thread_id.into()],
            ))
            .await
            .map_err(db_err)?;

            write_moderation_action(
                &txn,
                admin.id,
                "content_restored",
                "comment",
                content_id,
                None,
            )
            .await
            .map_err(db_err)?;

            txn.commit().await.map_err(db_err)?;
        }
        _ => {
            return Err(ApiError::BadRequest(
                "type must be 'thread' or 'comment'".into(),
            ));
        }
    }

    Ok(Json(
        serde_json::json!({ "restored": true, "type": content_type, "id": content_id }),
    ))
}

// ===========================================================================
// Routes
// ===========================================================================

pub fn routes() -> Router<AppState> {
    Router::new()
        // Auth
        .route("/admin/auth/me", get(admin_me))
        .route("/admin/auth/login", post(admin_login))
        .route("/admin/auth/logout", post(admin_logout))
        .route("/admin/auth/change-password", post(admin_change_password))
        // 2FA — TOTP
        .route("/admin/auth/totp/setup/begin", post(admin_totp_setup_begin))
        .route(
            "/admin/auth/totp/setup/confirm",
            post(admin_totp_setup_confirm),
        )
        .route("/admin/auth/totp/verify", post(admin_totp_verify))
        .route("/admin/auth/totp/recovery", post(admin_totp_recovery))
        // 2FA — Passkey
        .route(
            "/admin/auth/passkey/register/begin",
            post(admin_passkey_register_begin),
        )
        .route(
            "/admin/auth/passkey/register/finish",
            post(admin_passkey_register_finish),
        )
        .route(
            "/admin/auth/passkey/auth/begin",
            post(admin_passkey_auth_begin),
        )
        .route(
            "/admin/auth/passkey/auth/finish",
            post(admin_passkey_auth_finish),
        )
        .route("/admin/auth/passkey", get(admin_passkey_list))
        .route("/admin/auth/passkey/{id}", delete(admin_passkey_delete))
        // 2FA — Status & Reset
        .route("/admin/auth/2fa/status", get(admin_2fa_status))
        .route("/admin/auth/2fa/reset", post(admin_2fa_reset))
        // Dashboard
        .route("/admin/dashboard", get(admin_dashboard))
        // Users
        .route("/admin/users", get(admin_list_users))
        .route("/admin/users/{id}", get(admin_get_user))
        .route("/admin/users/{id}/role", patch(admin_change_user_role))
        .route("/admin/users/{id}/verify", patch(admin_toggle_verify))
        // Announcements
        .route(
            "/admin/announcements",
            get(admin_list_announcements).post(admin_create_announcement),
        )
        .route(
            "/admin/announcements/{id}",
            patch(admin_toggle_announcement).delete(admin_delete_announcement),
        )
        // Settings
        .route(
            "/admin/settings",
            get(admin_get_settings).patch(admin_update_settings),
        )
        // Invites
        .route("/admin/invites/generate", post(admin_generate_invites))
        .route("/admin/invites", get(admin_list_invites))
        // Modlog & Transparency
        .route("/admin/modlog", get(admin_modlog))
        .route("/admin/transparency", get(admin_transparency))
        // Moderation
        .route("/admin/reports", get(admin_list_reports))
        .route(
            "/admin/reports/{id}",
            get(admin_get_report).patch(admin_update_report),
        )
        .route("/admin/appeals", get(admin_list_appeals))
        .route("/admin/appeals/{id}", patch(admin_respond_appeal))
        .route("/admin/users/{id}/sanction", post(admin_issue_sanction))
        .route("/admin/users/{id}/sanctions", get(admin_user_sanctions))
        .route("/admin/sanctions/{id}", delete(admin_revoke_sanction))
        // Content moderation
        .route("/admin/content/{type}/{id}", delete(admin_delete_content))
        .route(
            "/admin/content/{type}/{id}/restore",
            post(admin_restore_content),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Contract test: ModlogResponse has paginated shape.
    #[test]
    fn modlog_response_shape() {
        let resp = ModlogResponse {
            items: vec![ModlogEntry {
                id: Uuid::nil(),
                admin_id: Uuid::nil(),
                admin_name: "Admin".into(),
                action_type: "warn".into(),
                target_type: "user".into(),
                target_id: Uuid::nil(),
                reason: Some("spam".into()),
                created_at: "2026-01-01T00:00:00+00:00".into(),
            }],
            total: 1,
            page: 1,
            limit: 50,
            has_more: false,
        };

        let json = serde_json::to_value(&resp).unwrap();
        let obj = json.as_object().unwrap();

        let keys = ["items", "total", "page", "limit", "hasMore"];
        for key in &keys {
            assert!(obj.contains_key(*key), "missing modlog field: {key}");
        }

        let entry = obj["items"].as_array().unwrap()[0].as_object().unwrap();
        let entry_keys = [
            "id",
            "adminId",
            "adminName",
            "actionType",
            "targetType",
            "targetId",
            "reason",
            "createdAt",
        ];
        for key in &entry_keys {
            assert!(
                entry.contains_key(*key),
                "missing modlog entry field: {key}"
            );
        }
    }

    /// Contract test: TransparencyResponse matches the admin dashboard payload.
    #[test]
    fn transparency_response_shape() {
        let resp = TransparencyResponse {
            period: TransparencyPeriod {
                from: "2026-01-01T00:00:00+00:00".into(),
                to: "2026-01-31T00:00:00+00:00".into(),
            },
            reports: TransparencyReports {
                by_status: vec![TransparencyStatusCount {
                    status: "pending".into(),
                    count: 3,
                }],
                by_reason: vec![TransparencyReasonCount {
                    reason: "spam".into(),
                    count: 2,
                }],
                by_content_type: vec![TransparencyContentTypeCount {
                    content_type: "thread".into(),
                    count: 4,
                }],
                avg_response_time_hours: Some(12.5),
            },
            actions: TransparencyActions {
                by_type: vec![TransparencyActionCount {
                    action_type: "user_warned".into(),
                    count: 1,
                }],
            },
            sanctions: TransparencySanctions {
                by_type: vec![TransparencySanctionTypeCount {
                    sanction_type: "warning".into(),
                    count: 1,
                }],
            },
            appeals: TransparencyAppeals {
                by_status: vec![TransparencyStatusCount {
                    status: "accepted".into(),
                    count: 1,
                }],
            },
        };

        let json = serde_json::to_value(&resp).unwrap();
        let obj = json.as_object().unwrap();

        let keys = ["period", "reports", "actions", "sanctions", "appeals"];
        for key in &keys {
            assert!(obj.contains_key(*key), "missing transparency field: {key}");
        }

        let abt = obj["actions"]["byType"].as_array().unwrap()[0]
            .as_object()
            .unwrap();
        assert!(abt.contains_key("actionType"));
        assert!(abt.contains_key("count"));
    }

    #[test]
    fn parse_api_datetime_rejects_naive_datetime() {
        assert!(parse_api_datetime("2026-04-07T12:34", "expiresAt").is_err());
    }

    #[test]
    fn paginate_clamps_to_postgres_bounds() {
        let (page, limit, offset) = paginate(Some(u64::MAX), Some(u64::MAX), 20, u64::MAX);

        assert_eq!(limit, i64::MAX as u64);
        assert_eq!(page, 2);
        assert_eq!(offset, i64::MAX as u64);
    }

    #[test]
    fn has_more_uses_saturating_add() {
        assert!(!has_more(u64::MAX, u64::MAX - 1, 10));
    }

    // ---- sha256_hex ----

    #[test]
    fn sha256_hex_known_vector() {
        // SHA-256 of empty string is well-known
        let hash = sha256_hex("");
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn sha256_hex_deterministic() {
        let a = sha256_hex("hello");
        let b = sha256_hex("hello");
        assert_eq!(a, b);
    }

    #[test]
    fn sha256_hex_different_inputs_differ() {
        let a = sha256_hex("hello");
        let b = sha256_hex("world");
        assert_ne!(a, b);
    }

    #[test]
    fn sha256_hex_length() {
        // SHA-256 hex digest is always 64 characters
        let hash = sha256_hex("test input");
        assert_eq!(hash.len(), 64);
    }

    // ---- generate_admin_token ----

    #[test]
    fn admin_token_not_empty() {
        let token = generate_admin_token();
        assert!(!token.is_empty());
    }

    #[test]
    fn admin_token_unique() {
        let a = generate_admin_token();
        let b = generate_admin_token();
        assert_ne!(a, b, "two generated tokens should differ");
    }

    #[test]
    fn admin_token_valid_base64url() {
        let token = generate_admin_token();
        // base64url uses [A-Za-z0-9_-], no padding (URL_SAFE_NO_PAD)
        assert!(
            token
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
            "token contains invalid base64url characters: {token}"
        );
    }

    #[test]
    fn admin_token_expected_length() {
        // 32 bytes → base64url-no-pad → ceil(32 * 4 / 3) = 43 chars
        let token = generate_admin_token();
        assert_eq!(
            token.len(),
            43,
            "32 bytes base64url-no-pad should be 43 chars"
        );
    }

    // ---- generate_invite_code ----

    #[test]
    fn invite_code_length_12() {
        let code = generate_invite_code();
        assert_eq!(code.len(), 12, "invite code should be exactly 12 chars");
    }

    #[test]
    fn invite_code_alphanumeric_lowercase() {
        let code = generate_invite_code();
        assert!(
            code.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
            "invite code should only contain [0-9a-z], got: {code}"
        );
    }

    #[test]
    fn invite_code_unique() {
        let a = generate_invite_code();
        let b = generate_invite_code();
        assert_ne!(a, b, "two generated invite codes should differ");
    }
}
