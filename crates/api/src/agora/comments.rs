use axum::Json;
use axum::extract::{Path, State};
use sea_orm::ActiveValue::Set;
use uuid::Uuid;

use tracing::warn;

use crate::AppState;
use eulesia_auth::session::AuthUser;
use eulesia_common::error::ApiError;
use eulesia_common::types::{UserRole, new_id};
use eulesia_db::repo::comments::CommentRepo;
use eulesia_db::repo::outbox_helpers::emit_event;
use eulesia_db::repo::threads::ThreadRepo;
use eulesia_db::repo::users::UserRepo;

use super::types::{AuthorSummary, CommentResponse, CreateCommentRequest, UpdateCommentRequest};

#[allow(clippy::needless_pass_by_value)] // used as fn pointer in map_err
fn db_err(e: sea_orm::DbErr) -> ApiError {
    ApiError::Database(e.to_string())
}

pub async fn create_comment(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    Json(req): Json<CreateCommentRequest>,
) -> Result<Json<CommentResponse>, ApiError> {
    if req.content.trim().is_empty() {
        return Err(ApiError::BadRequest("content must not be empty".into()));
    }

    // Verify thread exists and is not locked.
    let thread = ThreadRepo::find_by_id(&state.db, thread_id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

    if thread.is_locked {
        return Err(ApiError::Forbidden);
    }

    // Validate parent comment if provided.
    let depth = if let Some(parent_id) = req.parent_id {
        let parent = CommentRepo::find_by_id(&state.db, parent_id)
            .await
            .map_err(db_err)?
            .ok_or_else(|| ApiError::NotFound("parent comment not found".into()))?;

        if parent.thread_id != thread_id {
            return Err(ApiError::BadRequest(
                "parent comment belongs to a different thread".into(),
            ));
        }
        parent.depth + 1
    } else {
        0
    };

    let comment_id = new_id();
    let now = chrono::Utc::now().fixed_offset();

    let comment = CommentRepo::create(
        &state.db,
        eulesia_db::entities::comments::ActiveModel {
            id: Set(comment_id),
            thread_id: Set(thread_id),
            parent_id: Set(req.parent_id),
            author_id: Set(auth.user_id.0),
            content: Set(req.content),
            depth: Set(depth),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        },
    )
    .await
    .map_err(db_err)?;

    // Increment thread reply count.
    ThreadRepo::increment_reply_count(&state.db, thread_id, 1)
        .await
        .map_err(db_err)?;

    // Notify thread author (if not self-comment)
    if thread.author_id != auth.user_id.0 {
        if let Err(e) = emit_event(
            &*state.db,
            "notification",
            serde_json::json!({
                "user_id": thread.author_id.to_string(),
                "event_type": "reply",
                "title": "New reply on your thread",
                "body": null,
                "link": format!("/agora/threads/{}", thread.id),
            }),
        )
        .await
        {
            warn!("failed to emit notification event: {e}");
        }
    }

    // Fetch author for response.
    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    let author = AuthorSummary {
        id: user.id,
        username: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
        role: user.role,
    };

    Ok(Json(CommentResponse {
        id: comment.id,
        thread_id: comment.thread_id,
        parent_id: comment.parent_id,
        author,
        content: comment.content,
        content_html: comment.content_html,
        depth: comment.depth,
        score: comment.score,
        user_vote: None,
        created_at: comment.created_at.to_rfc3339(),
        updated_at: comment.updated_at.to_rfc3339(),
    }))
}

pub async fn update_comment(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateCommentRequest>,
) -> Result<Json<CommentResponse>, ApiError> {
    if req.content.trim().is_empty() {
        return Err(ApiError::BadRequest("content must not be empty".into()));
    }

    let comment = CommentRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("comment not found".into()))?;

    if comment.author_id != auth.user_id.0 {
        return Err(ApiError::Forbidden);
    }

    let now = chrono::Utc::now().fixed_offset();
    let updated = CommentRepo::update(
        &state.db,
        eulesia_db::entities::comments::ActiveModel {
            id: Set(id),
            content: Set(req.content),
            updated_at: Set(now),
            ..Default::default()
        },
    )
    .await
    .map_err(db_err)?;

    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    let author = AuthorSummary {
        id: user.id,
        username: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
        role: user.role,
    };

    Ok(Json(CommentResponse {
        id: updated.id,
        thread_id: updated.thread_id,
        parent_id: updated.parent_id,
        author,
        content: updated.content,
        content_html: updated.content_html,
        depth: updated.depth,
        score: updated.score,
        user_vote: None,
        created_at: updated.created_at.to_rfc3339(),
        updated_at: updated.updated_at.to_rfc3339(),
    }))
}

pub async fn delete_comment(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<(), ApiError> {
    let comment = CommentRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("comment not found".into()))?;

    // Allow author or moderator.
    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    let role: UserRole = user
        .role
        .parse()
        .map_err(|e: String| ApiError::Internal(e))?;

    if comment.author_id != auth.user_id.0 && !role.is_moderator() {
        return Err(ApiError::Forbidden);
    }

    CommentRepo::soft_delete(&state.db, id)
        .await
        .map_err(db_err)?;

    // Decrement thread reply count.
    ThreadRepo::increment_reply_count(&state.db, comment.thread_id, -1)
        .await
        .map_err(db_err)?;

    Ok(())
}
