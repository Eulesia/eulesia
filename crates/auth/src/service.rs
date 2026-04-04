use chrono::{Duration, Utc};
use sea_orm::{ActiveValue::Set, DatabaseConnection};
use serde::Deserialize;
use tracing::{info, warn};

use eulesia_common::types::{DeviceId, SessionId, UserId, UserRole, new_id};
use eulesia_db::entities::{sessions, users};
use eulesia_db::repo::sessions::SessionRepo;
use eulesia_db::repo::users::UserRepo;

use crate::error::AuthError;
use crate::password;
use crate::token::SessionToken;

pub struct AuthService;

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub name: String,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

impl AuthService {
    pub async fn register(
        db: &DatabaseConnection,
        req: RegisterRequest,
        ip: Option<String>,
        user_agent: Option<String>,
        session_max_age_days: u32,
    ) -> Result<(users::Model, SessionToken), AuthError> {
        validate_username(&req.username)?;
        password::validate_password_strength(&req.password)?;

        // Check username uniqueness
        if UserRepo::find_by_username(db, &req.username)
            .await
            .map_err(|e| AuthError::Database {
                context: "find user by username",
                source: e,
            })?
            .is_some()
        {
            return Err(AuthError::UsernameTaken(req.username));
        }

        // Check email uniqueness
        if let Some(ref email) = req.email {
            if UserRepo::find_by_email(db, email)
                .await
                .map_err(|e| AuthError::Database {
                    context: "check email uniqueness",
                    source: e,
                })?
                .is_some()
            {
                return Err(AuthError::EmailTaken(email.clone()));
            }
        }

        // Hash password (CPU-intensive)
        let password_str = req.password.clone();
        let hash = tokio::task::spawn_blocking(move || password::hash_password(&password_str))
            .await
            .map_err(|_| AuthError::HashingFailed)??;

        // Create user
        let user_id = new_id();
        let now = Utc::now().fixed_offset();
        let username = req.username.clone();
        let user = UserRepo::create(
            db,
            users::ActiveModel {
                id: Set(user_id),
                username: Set(req.username),
                email: Set(req.email),
                password_hash: Set(Some(hash)),
                name: Set(req.name),
                role: Set(UserRole::Citizen.as_str().to_string()),
                identity_verified: Set(false),
                identity_level: Set("basic".to_string()),
                locale: Set("en".to_string()),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| {
            // Catch unique constraint violations (race condition after pre-check)
            let msg = e.to_string();
            if msg.contains("unique") || msg.contains("duplicate") {
                return AuthError::UsernameTaken(username.clone());
            }
            AuthError::Database {
                context: "create user",
                source: e,
            }
        })?;

        info!(user_id = %user.id, username = %user.username, "user registered");

        // Best-effort search index
        if let Err(e) = eulesia_db::repo::outbox_helpers::emit_event(
            db,
            "user_created",
            serde_json::json!({
                "id": user.id.to_string(),
                "username": user.username,
                "name": user.name,
                "role": user.role,
            }),
        )
        .await
        {
            warn!("failed to emit user_created event: {e}");
        }

        // Create session
        let token = create_session(
            db,
            UserId(user.id),
            None,
            ip,
            user_agent,
            session_max_age_days,
        )
        .await?;

        Ok((user, token))
    }

    pub async fn login(
        db: &DatabaseConnection,
        req: LoginRequest,
        ip: Option<String>,
        user_agent: Option<String>,
        session_max_age_days: u32,
    ) -> Result<(users::Model, SessionToken), AuthError> {
        let user = UserRepo::find_by_username(db, &req.username)
            .await
            .map_err(|e| AuthError::Database {
                context: "find user by username",
                source: e,
            })?
            .ok_or(AuthError::InvalidCredentials)?;

        let stored_hash = user
            .password_hash
            .as_deref()
            .ok_or(AuthError::InvalidCredentials)?
            .to_string();

        let password = req.password.clone();
        let valid =
            tokio::task::spawn_blocking(move || password::verify_password(&password, &stored_hash))
                .await
                .map_err(|_| AuthError::HashingFailed)??;

        if !valid {
            return Err(AuthError::InvalidCredentials);
        }

        info!(user_id = %user.id, "user logged in");

        let token = create_session(
            db,
            UserId(user.id),
            None,
            ip,
            user_agent,
            session_max_age_days,
        )
        .await?;

        Ok((user, token))
    }

    pub async fn validate_session(
        db: &DatabaseConnection,
        token: &str,
    ) -> Result<(sessions::Model, users::Model), AuthError> {
        let token_obj = SessionToken::from_raw(token);
        let hash = token_obj.hash();

        let session = SessionRepo::find_by_token_hash(db, &hash)
            .await
            .map_err(|e| AuthError::Database {
                context: "find session by token",
                source: e,
            })?
            .ok_or(AuthError::InvalidCredentials)?;

        let now = Utc::now().fixed_offset();
        if session.expires_at < now {
            return Err(AuthError::SessionExpired);
        }

        let user = UserRepo::find_by_id(db, session.user_id)
            .await
            .map_err(|e| AuthError::Database {
                context: "find user by id",
                source: e,
            })?
            .ok_or(AuthError::UserNotFound)?;

        // Update last_used_at (best-effort, don't fail validation on it)
        let _ = SessionRepo::update_last_used(db, session.id).await;

        Ok((session, user))
    }

    pub async fn revoke_session(
        db: &DatabaseConnection,
        session_id: SessionId,
    ) -> Result<(), AuthError> {
        SessionRepo::revoke(db, session_id.0)
            .await
            .map_err(|e| AuthError::Database {
                context: "revoke session",
                source: e,
            })?;
        Ok(())
    }
}

async fn create_session(
    db: &DatabaseConnection,
    user_id: UserId,
    device_id: Option<DeviceId>,
    ip: Option<String>,
    user_agent: Option<String>,
    max_age_days: u32,
) -> Result<SessionToken, AuthError> {
    let token = SessionToken::generate();
    let now = Utc::now().fixed_offset();
    let expires = (Utc::now() + Duration::days(i64::from(max_age_days))).fixed_offset();

    SessionRepo::create(
        db,
        sessions::ActiveModel {
            id: Set(new_id()),
            user_id: Set(user_id.0),
            device_id: Set(device_id.map(|d| d.0)),
            token_hash: Set(token.hash()),
            ip_address: Set(ip),
            user_agent: Set(user_agent),
            expires_at: Set(expires),
            created_at: Set(now),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| AuthError::Database {
        context: "create session",
        source: e,
    })?;

    Ok(token)
}

fn validate_username(username: &str) -> Result<(), AuthError> {
    if username.len() < 3 {
        return Err(AuthError::InvalidUsername {
            reason: "username must be at least 3 characters".into(),
        });
    }
    if username.len() > 50 {
        return Err(AuthError::InvalidUsername {
            reason: "username must be at most 50 characters".into(),
        });
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(AuthError::InvalidUsername {
            reason: "username may only contain letters, numbers, and underscores".into(),
        });
    }
    if username.starts_with('_') || username.ends_with('_') {
        return Err(AuthError::InvalidUsername {
            reason: "username may not start or end with an underscore".into(),
        });
    }
    Ok(())
}
