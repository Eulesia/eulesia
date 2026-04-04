use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::{Path, Query, State};
use sea_orm::ActiveValue::Set;
use uuid::Uuid;

use tracing::warn;

use crate::AppState;
use eulesia_auth::session::{AuthUser, OptionalAuth};
use eulesia_common::error::ApiError;
use eulesia_common::types::{UserRole, new_id};
use eulesia_db::repo::blocks::BlockRepo;
use eulesia_db::repo::bookmarks::BookmarkRepo;
use eulesia_db::repo::comments::CommentRepo;
use eulesia_db::repo::outbox_helpers::emit_event;
use eulesia_db::repo::tags::TagRepo;
use eulesia_db::repo::thread_views::ThreadViewRepo;
use eulesia_db::repo::threads::ThreadRepo;
use eulesia_db::repo::users::UserRepo;
use eulesia_db::repo::votes::VoteRepo;

use super::types::{
    AuthorSummary, CommentListParams, CommentResponse, CreateThreadRequest, ThreadListParams,
    ThreadListResponse, ThreadResponse, UpdateThreadRequest,
};

const VALID_SCOPES: &[&str] = &["local", "national", "european"];
const DEFAULT_LIMIT: u64 = 20;
const MAX_LIMIT: u64 = 100;

fn validate_scope(scope: &str) -> Result<(), ApiError> {
    if !VALID_SCOPES.contains(&scope) {
        return Err(ApiError::BadRequest(format!(
            "invalid scope '{scope}': must be local, national, or european"
        )));
    }
    Ok(())
}

fn clamp_limit(limit: Option<u64>) -> u64 {
    limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT)
}

fn author_map(users: Vec<eulesia_db::entities::users::Model>) -> HashMap<Uuid, AuthorSummary> {
    users
        .into_iter()
        .map(|u| {
            (
                u.id,
                AuthorSummary {
                    id: u.id,
                    username: u.username,
                    name: u.name,
                    avatar_url: u.avatar_url,
                    role: u.role,
                },
            )
        })
        .collect()
}

fn deleted_author() -> AuthorSummary {
    AuthorSummary {
        id: Uuid::nil(),
        username: "[deleted]".into(),
        name: "[deleted]".into(),
        avatar_url: None,
        role: "user".into(),
    }
}

#[allow(clippy::needless_pass_by_value)] // used as fn pointer in map_err
fn db_err(e: sea_orm::DbErr) -> ApiError {
    ApiError::Database(e.to_string())
}

/// Compute the set of author IDs that should be excluded from results for the
/// authenticated user (union of users they blocked + users who blocked them).
async fn blocked_ids(
    db: &sea_orm::DatabaseConnection,
    user_id: Uuid,
) -> Result<Vec<Uuid>, ApiError> {
    let blocked = BlockRepo::blocked_by_user(db, user_id)
        .await
        .map_err(db_err)?;
    let blocked_by = BlockRepo::users_who_blocked(db, user_id)
        .await
        .map_err(db_err)?;

    let mut set: HashSet<Uuid> = HashSet::new();
    set.extend(blocked);
    set.extend(blocked_by);
    Ok(set.into_iter().collect())
}

// ---------------------------------------------------------------------------
// Enrichment helpers (reused by tags module)
// ---------------------------------------------------------------------------

/// Enrich a list of thread models into full `ThreadResponse`s.
pub async fn enrich_threads(
    db: &sea_orm::DatabaseConnection,
    threads: Vec<eulesia_db::entities::threads::Model>,
    auth_user_id: Option<Uuid>,
) -> Result<Vec<ThreadResponse>, ApiError> {
    if threads.is_empty() {
        return Ok(vec![]);
    }

    let thread_ids: Vec<Uuid> = threads.iter().map(|t| t.id).collect();
    let author_ids: Vec<Uuid> = threads
        .iter()
        .map(|t| t.author_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    // Batch fetch authors and tags.
    let users = UserRepo::find_by_ids(db, &author_ids)
        .await
        .map_err(db_err)?;
    let tag_models = TagRepo::tags_for_threads(db, &thread_ids)
        .await
        .map_err(db_err)?;

    let authors = author_map(users);

    // Build tag lookup: thread_id -> Vec<String>
    let mut tags_map: HashMap<Uuid, Vec<String>> = HashMap::new();
    for t in tag_models {
        tags_map.entry(t.thread_id).or_default().push(t.tag);
    }

    // Per-user enrichment (votes, bookmarks).
    let (vote_map, bookmark_set): (HashMap<Uuid, i16>, HashSet<Uuid>) = if let Some(uid) =
        auth_user_id
    {
        let votes = VoteRepo::get_user_votes_for_threads(db, &thread_ids, uid)
            .await
            .map_err(db_err)?;
        let bookmarks = BookmarkRepo::are_bookmarked(db, uid, &thread_ids)
            .await
            .map_err(db_err)?;

        let vm: HashMap<Uuid, i16> = votes.into_iter().map(|v| (v.thread_id, v.value)).collect();
        let bs: HashSet<Uuid> = bookmarks.into_iter().collect();
        (vm, bs)
    } else {
        (HashMap::new(), HashSet::new())
    };

    let responses = threads
        .into_iter()
        .map(|t| {
            let author = authors
                .get(&t.author_id)
                .cloned()
                .unwrap_or_else(deleted_author);
            ThreadResponse {
                id: t.id,
                title: t.title,
                content: t.content,
                content_html: t.content_html,
                scope: t.scope,
                author,
                tags: tags_map.remove(&t.id).unwrap_or_default(),
                reply_count: t.reply_count,
                score: t.score,
                view_count: t.view_count,
                user_vote: vote_map.get(&t.id).copied(),
                is_bookmarked: bookmark_set.contains(&t.id),
                is_pinned: t.is_pinned,
                is_locked: t.is_locked,
                created_at: t.created_at.to_rfc3339(),
                updated_at: t.updated_at.to_rfc3339(),
            }
        })
        .collect();

    Ok(responses)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub async fn list_threads(
    opt_auth: OptionalAuth,
    State(state): State<AppState>,
    Query(params): Query<ThreadListParams>,
) -> Result<Json<ThreadListResponse>, ApiError> {
    if let Some(ref scope) = params.scope {
        validate_scope(scope)?;
    }

    let user_id = opt_auth.0.as_ref().map(|a| a.user_id.0);
    let excluded = match user_id {
        Some(uid) => blocked_ids(&state.db, uid).await?,
        None => vec![],
    };

    let sort = params.sort.as_deref().unwrap_or("recent");
    let offset = params.offset.unwrap_or(0);
    let limit = clamp_limit(params.limit);

    // If filtering by tag, resolve thread IDs first, then pass them into
    // ThreadRepo::list so that sorting, visibility, and pagination are applied
    // correctly against the intersected set.
    let tag_ids = if let Some(ref tag) = params.tag {
        let (ids, _) = TagRepo::thread_ids_for_tag(&state.db, tag, 0, 100_000)
            .await
            .map_err(db_err)?;
        Some(ids)
    } else {
        None
    };

    let (threads, total) = ThreadRepo::list(
        &state.db,
        params.scope.as_deref(),
        params.municipality_id,
        None,
        tag_ids.as_deref(),
        &excluded,
        sort,
        offset,
        limit,
    )
    .await
    .map_err(db_err)?;

    let data = enrich_threads(&state.db, threads, user_id).await?;

    Ok(Json(ThreadListResponse {
        data,
        total,
        offset,
        limit,
    }))
}

#[allow(clippy::too_many_lines)]
pub async fn get_thread(
    opt_auth: OptionalAuth,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(comment_params): Query<CommentListParams>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = opt_auth.0.as_ref().map(|a| a.user_id.0);

    // Compute excluded (blocked) IDs first so we can check the thread author.
    let excluded = match user_id {
        Some(uid) => blocked_ids(&state.db, uid).await?,
        None => vec![],
    };

    let thread = ThreadRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

    if excluded.contains(&thread.author_id) {
        return Err(ApiError::NotFound("thread not found".into()));
    }

    // Fetch comments.
    let sort = comment_params.sort.as_deref().unwrap_or("best");
    let offset = comment_params.offset.unwrap_or(0);
    let limit = clamp_limit(comment_params.limit);

    let (comments, comments_total) =
        CommentRepo::list_for_thread(&state.db, id, &excluded, sort, offset, limit)
            .await
            .map_err(db_err)?;

    // Collect all author IDs (thread + comments).
    let mut all_author_ids: HashSet<Uuid> = HashSet::new();
    all_author_ids.insert(thread.author_id);
    for c in &comments {
        all_author_ids.insert(c.author_id);
    }
    let author_ids_vec: Vec<Uuid> = all_author_ids.into_iter().collect();

    // Batch fetch authors and tags.
    let users = UserRepo::find_by_ids(&state.db, &author_ids_vec)
        .await
        .map_err(db_err)?;
    let tags = TagRepo::tags_for_thread(&state.db, id)
        .await
        .map_err(db_err)?;

    let authors = author_map(users);

    // Per-user vote/bookmark data for the thread + comments.
    let comment_ids: Vec<Uuid> = comments.iter().map(|c| c.id).collect();
    let (thread_vote, is_bookmarked, comment_vote_map): (Option<i16>, bool, HashMap<Uuid, i16>) =
        if let Some(uid) = user_id {
            let tv = VoteRepo::get_user_vote_for_thread(&state.db, id, uid)
                .await
                .map_err(db_err)?;
            let bm = BookmarkRepo::is_bookmarked(&state.db, uid, id)
                .await
                .map_err(db_err)?;
            let cv = VoteRepo::get_user_votes_for_comments(&state.db, &comment_ids, uid)
                .await
                .map_err(db_err)?;

            let cvm: HashMap<Uuid, i16> = cv.into_iter().map(|v| (v.comment_id, v.value)).collect();
            (tv, bm, cvm)
        } else {
            (None, false, HashMap::new())
        };

    let thread_author = authors
        .get(&thread.author_id)
        .cloned()
        .unwrap_or_else(deleted_author);

    let thread_resp = ThreadResponse {
        id: thread.id,
        title: thread.title,
        content: thread.content,
        content_html: thread.content_html,
        scope: thread.scope,
        author: thread_author,
        tags,
        reply_count: thread.reply_count,
        score: thread.score,
        view_count: thread.view_count,
        user_vote: thread_vote,
        is_bookmarked,
        is_pinned: thread.is_pinned,
        is_locked: thread.is_locked,
        created_at: thread.created_at.to_rfc3339(),
        updated_at: thread.updated_at.to_rfc3339(),
    };

    let comment_resps: Vec<CommentResponse> = comments
        .into_iter()
        .map(|c| {
            let author = authors
                .get(&c.author_id)
                .cloned()
                .unwrap_or_else(deleted_author);
            CommentResponse {
                id: c.id,
                thread_id: c.thread_id,
                parent_id: c.parent_id,
                author,
                content: c.content,
                content_html: c.content_html,
                depth: c.depth,
                score: c.score,
                user_vote: comment_vote_map.get(&c.id).copied(),
                created_at: c.created_at.to_rfc3339(),
                updated_at: c.updated_at.to_rfc3339(),
            }
        })
        .collect();

    Ok(Json(serde_json::json!({
        "thread": thread_resp,
        "comments": {
            "data": comment_resps,
            "total": comments_total,
            "offset": offset,
            "limit": limit,
        }
    })))
}

pub async fn create_thread(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateThreadRequest>,
) -> Result<Json<ThreadResponse>, ApiError> {
    validate_scope(&req.scope)?;

    if req.scope == "local" && req.municipality_id.is_none() {
        return Err(ApiError::BadRequest(
            "municipality_id is required for local scope".into(),
        ));
    }
    if req.title.trim().is_empty() {
        return Err(ApiError::BadRequest("title must not be empty".into()));
    }
    if req.content.trim().is_empty() {
        return Err(ApiError::BadRequest("content must not be empty".into()));
    }

    let thread_id = new_id();
    let now = chrono::Utc::now().fixed_offset();

    let thread = ThreadRepo::create(
        &state.db,
        eulesia_db::entities::threads::ActiveModel {
            id: Set(thread_id),
            title: Set(req.title),
            content: Set(req.content),
            author_id: Set(auth.user_id.0),
            scope: Set(req.scope),
            municipality_id: Set(req.municipality_id),
            language: Set(req.language),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        },
    )
    .await
    .map_err(db_err)?;

    // Add tags if provided.
    if let Some(ref tags) = req.tags {
        if !tags.is_empty() {
            TagRepo::add_tags(&state.db, thread_id, tags)
                .await
                .map_err(db_err)?;
        }
    }

    // Best-effort search index event
    if let Err(e) = emit_event(
        &*state.db,
        "thread_created",
        serde_json::json!({
            "id": thread.id.to_string(),
            "title": thread.title,
            "content": thread.content,
            "author_id": thread.author_id.to_string(),
            "scope": thread.scope,
            "created_at": thread.created_at.timestamp(),
        }),
    )
    .await
    {
        warn!("failed to emit thread_created event: {e}");
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

    Ok(Json(ThreadResponse {
        id: thread.id,
        title: thread.title,
        content: thread.content,
        content_html: thread.content_html,
        scope: thread.scope,
        author,
        tags: req.tags.unwrap_or_default(),
        reply_count: thread.reply_count,
        score: thread.score,
        view_count: thread.view_count,
        user_vote: None,
        is_bookmarked: false,
        is_pinned: thread.is_pinned,
        is_locked: thread.is_locked,
        created_at: thread.created_at.to_rfc3339(),
        updated_at: thread.updated_at.to_rfc3339(),
    }))
}

pub async fn update_thread(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateThreadRequest>,
) -> Result<Json<ThreadResponse>, ApiError> {
    let thread = ThreadRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

    if thread.author_id != auth.user_id.0 {
        return Err(ApiError::Forbidden);
    }

    let now = chrono::Utc::now().fixed_offset();
    let mut am = eulesia_db::entities::threads::ActiveModel {
        id: Set(id),
        updated_at: Set(now),
        ..Default::default()
    };

    if let Some(title) = req.title {
        if title.trim().is_empty() {
            return Err(ApiError::BadRequest("title must not be empty".into()));
        }
        am.title = Set(title);
    }
    if let Some(content) = req.content {
        if content.trim().is_empty() {
            return Err(ApiError::BadRequest("content must not be empty".into()));
        }
        am.content = Set(content);
    }

    let updated = ThreadRepo::update(&state.db, am).await.map_err(db_err)?;

    // Sync tags if provided.
    let tags = if let Some(new_tags) = req.tags {
        TagRepo::remove_all_tags(&state.db, id)
            .await
            .map_err(db_err)?;
        if !new_tags.is_empty() {
            TagRepo::add_tags(&state.db, id, &new_tags)
                .await
                .map_err(db_err)?;
        }
        new_tags
    } else {
        TagRepo::tags_for_thread(&state.db, id)
            .await
            .map_err(db_err)?
    };

    // Best-effort search index event
    if let Err(e) = emit_event(
        &*state.db,
        "thread_updated",
        serde_json::json!({
            "id": updated.id.to_string(),
            "title": updated.title,
            "content": updated.content,
            "author_id": updated.author_id.to_string(),
            "scope": updated.scope,
            "created_at": updated.created_at.timestamp(),
        }),
    )
    .await
    {
        warn!("failed to emit thread_updated event: {e}");
    }

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

    Ok(Json(ThreadResponse {
        id: updated.id,
        title: updated.title,
        content: updated.content,
        content_html: updated.content_html,
        scope: updated.scope,
        author,
        tags,
        reply_count: updated.reply_count,
        score: updated.score,
        view_count: updated.view_count,
        user_vote: None,
        is_bookmarked: false,
        is_pinned: updated.is_pinned,
        is_locked: updated.is_locked,
        created_at: updated.created_at.to_rfc3339(),
        updated_at: updated.updated_at.to_rfc3339(),
    }))
}

pub async fn delete_thread(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<(), ApiError> {
    let thread = ThreadRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

    // Allow author or moderator.
    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    let role: UserRole = user
        .role
        .parse()
        .map_err(|e: String| ApiError::Internal(e))?;

    if thread.author_id != auth.user_id.0 && !role.is_moderator() {
        return Err(ApiError::Forbidden);
    }

    ThreadRepo::soft_delete(&state.db, id)
        .await
        .map_err(db_err)?;

    // Best-effort search index event
    if let Err(e) = emit_event(
        &*state.db,
        "thread_deleted",
        serde_json::json!({
            "id": id.to_string(),
        }),
    )
    .await
    {
        warn!("failed to emit thread_deleted event: {e}");
    }

    Ok(())
}

/// Record a thread view. Requires authentication to prevent anonymous
/// spam. View count is incremented at most once per user per thread
/// using a dedicated `thread_views` dedup table.
pub async fn record_view(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<(), ApiError> {
    ThreadRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

    let is_new = ThreadViewRepo::record_view(&state.db, id, auth.user_id.0)
        .await
        .map_err(db_err)?;

    if is_new {
        ThreadRepo::increment_view_count(&state.db, id)
            .await
            .map_err(db_err)?;
    }

    Ok(())
}
