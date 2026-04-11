use axum::Json;
use axum::Router;
use axum::extract::{Path, State};
use axum::routing::{get, post};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ConnectionTrait, DatabaseBackend, Statement};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use eulesia_auth::session::{AuthUser, OptionalAuth};
use eulesia_common::error::ApiError;
use eulesia_db::repo::sessions::SessionRepo;
use eulesia_db::repo::subscriptions::SubscriptionRepo;
use eulesia_db::repo::users::UserRepo;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct UserProfileResponse {
    pub id: Uuid,
    pub username: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub role: String,
    pub institution_type: Option<String>,
    pub institution_name: Option<String>,
    pub identity_verified: bool,
    pub identity_provider: Option<String>,
    pub municipality_id: Option<Uuid>,
    pub municipality: Option<crate::map::MunicipalityResponse>,
    pub created_at: String,
    pub threads: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bot_summaries: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfileRequest {
    pub name: Option<String>,
    pub bio: Option<String>,
    pub avatar_url: Option<String>,
    pub locale: Option<String>,
    pub municipality_id: Option<Option<Uuid>>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn user_to_profile(
    db: &sea_orm::DatabaseConnection,
    user: eulesia_db::entities::users::Model,
) -> Result<UserProfileResponse, ApiError> {
    let municipality = crate::map::municipality_response_by_id(db, user.municipality_id).await?;

    Ok(UserProfileResponse {
        id: user.id,
        username: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
        bio: user.bio,
        role: user.role,
        institution_type: user.institution_type,
        institution_name: user.institution_name,
        identity_verified: user.identity_verified,
        identity_provider: user.identity_provider,
        municipality_id: user.municipality_id,
        municipality,
        created_at: user.created_at.to_rfc3339(),
        threads: vec![],
        bot_summaries: vec![],
    })
}

async fn export_rows(
    db: &impl ConnectionTrait,
    sql: &str,
    user_id: Uuid,
    label: &str,
    mapper: impl Fn(&sea_orm::QueryResult) -> Option<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, ApiError> {
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            sql,
            [user_id.into()],
        ))
        .await
        .map_err(|e| ApiError::Database(format!("export {label}: {e}")))?;
    Ok(rows.iter().filter_map(mapper).collect())
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /users/{id} — public profile.
pub async fn get_user_profile(
    _opt_auth: OptionalAuth,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<UserProfileResponse>, ApiError> {
    let user = UserRepo::find_by_id(&state.db, id)
        .await
        .map_err(|e| ApiError::Database(format!("find user: {e}")))?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    if user.deleted_at.is_some() {
        return Err(ApiError::NotFound("user not found".into()));
    }

    let profile_user_role = user.role.clone();

    // Include user's recent public threads
    use eulesia_db::entities::threads;
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
    let user_threads = threads::Entity::find()
        .filter(threads::Column::AuthorId.eq(id))
        .filter(threads::Column::DeletedAt.is_null())
        .filter(threads::Column::IsHidden.eq(false))
        .filter(threads::Column::ClubId.is_null())
        .order_by_desc(threads::Column::CreatedAt)
        .all(&*state.db)
        .await
        .map_err(|e| ApiError::Database(format!("list user threads: {e}")))?;

    let thread_values: Vec<serde_json::Value> = user_threads
        .into_iter()
        .take(20)
        .map(|t| {
            serde_json::json!({
                "id": t.id,
                "title": t.title,
                "content": t.content,
                "contentHtml": t.content_html,
                "scope": t.scope,
                "authorId": t.author_id,
                "replyCount": t.reply_count,
                "score": t.score,
                "viewCount": t.view_count,
                "language": t.language,
                "tags": [],
                "isPinned": t.is_pinned,
                "isLocked": t.is_locked,
                "isBookmarked": false,
                "userVote": null,
                "createdAt": t.created_at.to_rfc3339(),
                "updatedAt": t.updated_at.to_rfc3339(),
            })
        })
        .collect();

    // Fetch bot summaries: threads where source_institution_id = this user
    // (Eulesia Summary threads linked to this institution)
    let bot_summary_threads = if profile_user_role == "institution" {
        threads::Entity::find()
            .filter(threads::Column::SourceInstitutionId.eq(id))
            .filter(threads::Column::DeletedAt.is_null())
            .filter(threads::Column::IsHidden.eq(false))
            .filter(threads::Column::ClubId.is_null())
            .order_by_desc(threads::Column::CreatedAt)
            .all(&*state.db)
            .await
            .map_err(|e| ApiError::Database(format!("list bot summaries: {e}")))?
    } else {
        vec![]
    };

    let bot_summary_values: Vec<serde_json::Value> = bot_summary_threads
        .into_iter()
        .take(20)
        .map(|t| {
            serde_json::json!({
                "id": t.id,
                "title": t.title,
                "content": t.content,
                "contentHtml": t.content_html,
                "scope": t.scope,
                "authorId": t.author_id,
                "replyCount": t.reply_count,
                "score": t.score,
                "viewCount": t.view_count,
                "language": t.language,
                "tags": [],
                "isPinned": t.is_pinned,
                "isLocked": t.is_locked,
                "isBookmarked": false,
                "userVote": null,
                "createdAt": t.created_at.to_rfc3339(),
                "updatedAt": t.updated_at.to_rfc3339(),
            })
        })
        .collect();

    let mut profile = user_to_profile(&state.db, user).await?;
    profile.threads = thread_values;
    profile.bot_summaries = bot_summary_values;
    Ok(Json(profile))
}

/// PATCH /users/me — update own profile.
async fn update_my_profile(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateProfileRequest>,
) -> Result<Json<UserProfileResponse>, ApiError> {
    // Ensure user exists and is not soft-deleted.
    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(format!("find user: {e}")))?
        .ok_or(ApiError::Unauthorized)?;

    if user.deleted_at.is_some() {
        return Err(ApiError::Unauthorized);
    }

    let now = chrono::Utc::now().fixed_offset();

    let mut am = eulesia_db::entities::users::ActiveModel {
        id: Set(auth.user_id.0),
        updated_at: Set(now),
        ..Default::default()
    };

    if let Some(name) = req.name {
        if name.trim().is_empty() {
            return Err(ApiError::BadRequest("name must not be empty".into()));
        }
        am.name = Set(name);
    }
    if let Some(bio) = req.bio {
        am.bio = Set(Some(bio));
    }
    if let Some(avatar_url) = req.avatar_url {
        am.avatar_url = Set(Some(avatar_url));
    }
    if let Some(locale) = req.locale {
        am.locale = Set(locale);
    }
    if let Some(municipality_id) = req.municipality_id {
        if let Some(municipality_id) = municipality_id {
            let municipality =
                crate::map::municipality_response_by_id(state.db.as_ref(), Some(municipality_id))
                    .await?;

            if municipality.is_none() {
                return Err(ApiError::BadRequest("municipalityId does not exist".into()));
            }
        }
        am.municipality_id = Set(municipality_id);
    }

    let updated = UserRepo::update(&state.db, am)
        .await
        .map_err(|e| ApiError::Database(format!("update user profile: {e}")))?;
    if let Some(Some(municipality_id)) = req.municipality_id {
        SubscriptionRepo::upsert(
            &state.db,
            auth.user_id.0,
            "municipality",
            &municipality_id.to_string(),
            "all",
        )
        .await
        .map_err(|e| ApiError::Database(format!("auto-follow municipality: {e}")))?;
    }
    Ok(Json(user_to_profile(&state.db, updated).await?))
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UserSettingsResponse {
    locale: String,
    notification_replies: bool,
    notification_mentions: bool,
    notification_official: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSettingsRequest {
    locale: Option<String>,
    notification_replies: Option<bool>,
    notification_mentions: Option<bool>,
    notification_official: Option<bool>,
}

/// GET /users/settings
async fn get_settings(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<UserSettingsResponse>, ApiError> {
    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or(ApiError::Unauthorized)?;

    Ok(Json(UserSettingsResponse {
        locale: user.locale,
        notification_replies: user.notification_replies,
        notification_mentions: user.notification_mentions,
        notification_official: user.notification_official,
    }))
}

/// PATCH /users/settings
async fn update_settings(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateSettingsRequest>,
) -> Result<Json<UserSettingsResponse>, ApiError> {
    use eulesia_db::entities::users;

    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or(ApiError::Unauthorized)?;

    let mut am: users::ActiveModel = user.into();
    am.updated_at = Set(chrono::Utc::now().fixed_offset());

    if let Some(locale) = req.locale {
        am.locale = Set(locale);
    }
    if let Some(v) = req.notification_replies {
        am.notification_replies = Set(v);
    }
    if let Some(v) = req.notification_mentions {
        am.notification_mentions = Set(v);
    }
    if let Some(v) = req.notification_official {
        am.notification_official = Set(v);
    }

    let updated = am
        .update(&*state.db)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(UserSettingsResponse {
        locale: updated.locale,
        notification_replies: updated.notification_replies,
        notification_mentions: updated.notification_mentions,
        notification_official: updated.notification_official,
    }))
}

// ---------------------------------------------------------------------------
// DELETE /users/me — soft-delete account (GDPR)
// ---------------------------------------------------------------------------

/// DELETE /users/me — anonymize and soft-delete the authenticated user.
async fn delete_my_account(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(format!("find user: {e}")))?
        .ok_or(ApiError::Unauthorized)?;

    if user.deleted_at.is_some() {
        return Err(ApiError::NotFound("user not found".into()));
    }

    let now = chrono::Utc::now().fixed_offset();
    let anonymized_email = format!("deleted_{}@deleted.eulesia.eu", auth.user_id.0);

    let am = eulesia_db::entities::users::ActiveModel {
        id: Set(auth.user_id.0),
        name: Set("[Poistettu käyttäjä]".into()),
        email: Set(Some(anonymized_email)),
        avatar_url: Set(None),
        bio: Set(None),
        deleted_at: Set(Some(now)),
        updated_at: Set(now),
        ..Default::default()
    };

    UserRepo::update(&state.db, am)
        .await
        .map_err(|e| ApiError::Database(format!("soft-delete user: {e}")))?;

    // Revoke all active sessions.
    SessionRepo::revoke_all_for_user(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(format!("revoke sessions: {e}")))?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ---------------------------------------------------------------------------
// POST /users/me/onboarding-complete
// ---------------------------------------------------------------------------

/// POST /users/me/onboarding-complete -- mark onboarding as completed.
async fn onboarding_complete(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let now = chrono::Utc::now().fixed_offset();

    let am = eulesia_db::entities::users::ActiveModel {
        id: Set(auth.user_id.0),
        onboarding_completed_at: Set(Some(now)),
        updated_at: Set(now),
        ..Default::default()
    };

    UserRepo::update(&state.db, am)
        .await
        .map_err(|e| ApiError::Database(format!("onboarding complete: {e}")))?;

    Ok(Json(
        serde_json::json!({ "onboardingCompletedAt": now.to_rfc3339() }),
    ))
}

// ---------------------------------------------------------------------------
// GET /users/me/data -- GDPR data export
// ---------------------------------------------------------------------------

/// GET /users/me/data -- export all user data for GDPR compliance.
async fn export_my_data(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = auth.user_id.0;
    let db = state.db.as_ref();

    let user = UserRepo::find_by_id(db, user_id)
        .await
        .map_err(|e| ApiError::Database(format!("find user: {e}")))?
        .ok_or(ApiError::Unauthorized)?;

    let profile = serde_json::json!({
        "id": user.id, "username": user.username, "email": user.email,
        "name": user.name, "bio": user.bio, "role": user.role,
        "locale": user.locale, "createdAt": user.created_at.to_rfc3339(),
    });

    type DT = chrono::DateTime<chrono::FixedOffset>;

    let threads = export_rows(db,
        r"SELECT id, title, content, scope, created_at FROM threads WHERE author_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
        user_id, "threads", |r| Some(serde_json::json!({
            "id": r.try_get_by_index::<Uuid>(0).ok()?, "title": r.try_get_by_index::<String>(1).ok()?,
            "content": r.try_get_by_index::<String>(2).ok()?, "scope": r.try_get_by_index::<String>(3).ok()?,
            "createdAt": r.try_get_by_index::<DT>(4).ok()?.to_rfc3339(),
        }))).await?;

    let comments = export_rows(db,
        r"SELECT id, thread_id, content, created_at FROM comments WHERE author_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
        user_id, "comments", |r| Some(serde_json::json!({
            "id": r.try_get_by_index::<Uuid>(0).ok()?, "threadId": r.try_get_by_index::<Uuid>(1).ok()?,
            "content": r.try_get_by_index::<String>(2).ok()?,
            "createdAt": r.try_get_by_index::<DT>(3).ok()?.to_rfc3339(),
        }))).await?;

    let votes = export_rows(db,
        r"SELECT thread_id, value, created_at FROM thread_votes WHERE user_id = $1 ORDER BY created_at DESC",
        user_id, "votes", |r| Some(serde_json::json!({
            "threadId": r.try_get_by_index::<Uuid>(0).ok()?, "value": r.try_get_by_index::<i16>(1).ok()?,
            "createdAt": r.try_get_by_index::<DT>(2).ok()?.to_rfc3339(),
        }))).await?;

    let subscriptions = export_rows(db,
        r"SELECT entity_type, entity_id, notify, created_at FROM user_subscriptions WHERE user_id = $1",
        user_id, "subscriptions", |r| Some(serde_json::json!({
            "entityType": r.try_get_by_index::<String>(0).ok()?, "entityId": r.try_get_by_index::<String>(1).ok()?,
            "notify": r.try_get_by_index::<String>(2).ok()?,
            "createdAt": r.try_get_by_index::<DT>(3).ok()?.to_rfc3339(),
        }))).await?;

    let notifications = export_rows(db,
        r"SELECT id, event_type, title, body, read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC",
        user_id, "notifications", |r| Some(serde_json::json!({
            "id": r.try_get_by_index::<Uuid>(0).ok()?, "eventType": r.try_get_by_index::<String>(1).ok()?,
            "title": r.try_get_by_index::<String>(2).ok()?, "body": r.try_get_by_index::<Option<String>>(3).ok()?,
            "read": r.try_get_by_index::<bool>(4).ok()?,
            "createdAt": r.try_get_by_index::<DT>(5).ok()?.to_rfc3339(),
        }))).await?;

    let messages = export_rows(db,
        r"SELECT id, conversation_id, message_type, server_ts FROM messages WHERE sender_id = $1 ORDER BY server_ts DESC",
        user_id, "messages", |r| Some(serde_json::json!({
            "id": r.try_get_by_index::<Uuid>(0).ok()?, "conversationId": r.try_get_by_index::<Uuid>(1).ok()?,
            "messageType": r.try_get_by_index::<String>(2).ok()?,
            "serverTs": r.try_get_by_index::<DT>(3).ok()?.to_rfc3339(),
        }))).await?;

    let bookmarks = export_rows(
        db,
        r"SELECT thread_id, created_at FROM bookmarks WHERE user_id = $1",
        user_id,
        "bookmarks",
        |r| {
            Some(serde_json::json!({
                "threadId": r.try_get_by_index::<Uuid>(0).ok()?,
                "createdAt": r.try_get_by_index::<DT>(1).ok()?.to_rfc3339(),
            }))
        },
    )
    .await?;

    let following = export_rows(
        db,
        r"SELECT followed_id, created_at FROM follows WHERE follower_id = $1",
        user_id,
        "following",
        |r| {
            Some(serde_json::json!({
                "followedId": r.try_get_by_index::<Uuid>(0).ok()?,
                "createdAt": r.try_get_by_index::<DT>(1).ok()?.to_rfc3339(),
            }))
        },
    )
    .await?;

    let followers = export_rows(
        db,
        r"SELECT follower_id, created_at FROM follows WHERE followed_id = $1",
        user_id,
        "followers",
        |r| {
            Some(serde_json::json!({
                "followerId": r.try_get_by_index::<Uuid>(0).ok()?,
                "createdAt": r.try_get_by_index::<DT>(1).ok()?.to_rfc3339(),
            }))
        },
    )
    .await?;

    let blocks = export_rows(
        db,
        r"SELECT blocked_id, created_at FROM blocks WHERE blocker_id = $1",
        user_id,
        "blocks",
        |r| {
            Some(serde_json::json!({
                "blockedId": r.try_get_by_index::<Uuid>(0).ok()?,
                "createdAt": r.try_get_by_index::<DT>(1).ok()?.to_rfc3339(),
            }))
        },
    )
    .await?;

    let mutes = export_rows(
        db,
        r"SELECT muted_id, created_at FROM mutes WHERE user_id = $1",
        user_id,
        "mutes",
        |r| {
            Some(serde_json::json!({
                "mutedId": r.try_get_by_index::<Uuid>(0).ok()?,
                "createdAt": r.try_get_by_index::<DT>(1).ok()?.to_rfc3339(),
            }))
        },
    )
    .await?;

    let club_memberships = export_rows(db,
        r"SELECT cm.club_id, c.name, cm.role, cm.joined_at FROM club_members cm JOIN clubs c ON c.id = cm.club_id WHERE cm.user_id = $1",
        user_id, "clubs", |r| Some(serde_json::json!({
            "clubId": r.try_get_by_index::<Uuid>(0).ok()?, "clubName": r.try_get_by_index::<String>(1).ok()?,
            "role": r.try_get_by_index::<String>(2).ok()?,
            "joinedAt": r.try_get_by_index::<DT>(3).ok()?.to_rfc3339(),
        }))).await?;

    let devices = export_rows(db,
        r"SELECT id, display_name, platform, created_at FROM devices WHERE user_id = $1 AND revoked_at IS NULL",
        user_id, "devices", |r| Some(serde_json::json!({
            "id": r.try_get_by_index::<Uuid>(0).ok()?, "displayName": r.try_get_by_index::<Option<String>>(1).ok()?,
            "platform": r.try_get_by_index::<String>(2).ok()?,
            "createdAt": r.try_get_by_index::<DT>(3).ok()?.to_rfc3339(),
        }))).await?;

    let reports = export_rows(db,
        r"SELECT id, content_type, content_id, reason, status, created_at FROM content_reports WHERE reporter_id = $1 ORDER BY created_at DESC",
        user_id, "reports", |r| Some(serde_json::json!({
            "id": r.try_get_by_index::<Uuid>(0).ok()?, "contentType": r.try_get_by_index::<String>(1).ok()?,
            "contentId": r.try_get_by_index::<Uuid>(2).ok()?, "reason": r.try_get_by_index::<String>(3).ok()?,
            "status": r.try_get_by_index::<String>(4).ok()?,
            "createdAt": r.try_get_by_index::<DT>(5).ok()?.to_rfc3339(),
        }))).await?;

    Ok(Json(serde_json::json!({
        "profile": profile, "threads": threads, "comments": comments, "votes": votes,
        "subscriptions": subscriptions, "notifications": notifications, "messages": messages,
        "bookmarks": bookmarks, "following": following, "followers": followers,
        "blocks": blocks, "mutes": mutes, "clubMemberships": club_memberships,
        "devices": devices, "reports": reports, "exportedAt": chrono::Utc::now().to_rfc3339(),
    })))
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/users/{id}", get(get_user_profile))
        .route(
            "/users/me",
            axum::routing::patch(update_my_profile).delete(delete_my_account),
        )
        .route("/users/me/onboarding-complete", post(onboarding_complete))
        .route("/users/me/data", get(export_my_data))
        .route("/users/settings", get(get_settings).patch(update_settings))
        .route(
            "/users/{id}/devices",
            get(crate::devices::list_user_devices),
        )
}
