use std::collections::{HashMap, HashSet};

use sea_orm::entity::prelude::{DateTimeWithTimeZone, Decimal};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseBackend,
    DatabaseConnection, DbErr, EntityTrait, FromQueryResult, QueryFilter, Statement,
    TransactionTrait,
};
use serde_json::Value as JsonValue;
use tracing::info;
use uuid::Uuid;

use crate::entities::{
    club_members, clubs, comment_votes, comments, edit_history, thread_tags, thread_views,
    thread_votes, threads,
};

#[derive(Debug, Default, Clone, Copy)]
pub struct LegacyImportReport {
    pub public_clubs_inserted: usize,
    pub public_clubs_merged: usize,
    pub private_rooms_inserted: usize,
    pub memberships_inserted: usize,
    pub memberships_updated: usize,
    pub threads_inserted: usize,
    pub comments_inserted: usize,
    pub thread_votes_inserted: usize,
    pub comment_votes_inserted: usize,
    pub thread_tags_inserted: usize,
    pub thread_views_inserted: usize,
    pub edit_history_inserted: usize,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyClub {
    id: Uuid,
    name: String,
    slug: String,
    description: Option<String>,
    category: Option<String>,
    creator_id: Uuid,
    rules_json: Option<String>,
    cover_image_url: Option<String>,
    is_public: bool,
    latitude: Option<Decimal>,
    longitude: Option<Decimal>,
    address: Option<String>,
    created_at: DateTimeWithTimeZone,
    updated_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyRoom {
    id: Uuid,
    owner_id: Uuid,
    name: String,
    description: Option<String>,
    visibility: String,
    created_at: DateTimeWithTimeZone,
    updated_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyClubMembership {
    club_id: Uuid,
    user_id: Uuid,
    role: String,
    joined_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyRoomMembership {
    room_id: Uuid,
    user_id: Uuid,
    joined_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyPublicThread {
    id: Uuid,
    title: String,
    content: String,
    content_html: Option<String>,
    author_id: Uuid,
    scope: String,
    country: Option<String>,
    municipality_id: Option<Uuid>,
    location_id: Option<Uuid>,
    place_id: Option<Uuid>,
    latitude: Option<Decimal>,
    longitude: Option<Decimal>,
    institutional_context: Option<JsonValue>,
    is_pinned: bool,
    is_locked: bool,
    reply_count: i32,
    score: i32,
    view_count: i32,
    source: String,
    source_url: Option<String>,
    source_id: Option<String>,
    source_institution_id: Option<Uuid>,
    ai_generated: bool,
    ai_model: Option<String>,
    language: Option<String>,
    is_hidden: bool,
    created_at: DateTimeWithTimeZone,
    updated_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyClubThread {
    id: Uuid,
    club_id: Uuid,
    author_id: Uuid,
    title: String,
    content: String,
    content_html: Option<String>,
    is_pinned: bool,
    is_locked: bool,
    reply_count: i32,
    score: i32,
    is_hidden: bool,
    language: Option<String>,
    created_at: DateTimeWithTimeZone,
    updated_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyRoomThread {
    id: Uuid,
    room_id: Uuid,
    author_id: Uuid,
    title: String,
    content: String,
    content_html: Option<String>,
    is_pinned: bool,
    is_locked: bool,
    reply_count: i32,
    score: i32,
    is_hidden: bool,
    created_at: DateTimeWithTimeZone,
    updated_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyComment {
    id: Uuid,
    thread_id: Uuid,
    parent_id: Option<Uuid>,
    author_id: Uuid,
    content: String,
    content_html: Option<String>,
    depth: Option<i32>,
    score: i32,
    is_hidden: bool,
    language: Option<String>,
    created_at: DateTimeWithTimeZone,
    updated_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyThreadVote {
    thread_id: Uuid,
    user_id: Uuid,
    value: i16,
    created_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyCommentVote {
    comment_id: Uuid,
    user_id: Uuid,
    value: i16,
    created_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyThreadTag {
    thread_id: Uuid,
    tag: String,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyThreadView {
    thread_id: Uuid,
    user_id: Uuid,
    viewed_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone, FromQueryResult)]
struct LegacyEditHistory {
    id: Uuid,
    content_type: String,
    content_id: Uuid,
    edited_by: Uuid,
    previous_content: String,
    previous_content_html: Option<String>,
    previous_title: Option<String>,
    edited_at: DateTimeWithTimeZone,
}

#[derive(Debug, Clone)]
struct DesiredMembership {
    club_id: Uuid,
    user_id: Uuid,
    role: String,
    joined_at: DateTimeWithTimeZone,
}

pub async fn import_legacy_social_data(
    target: &DatabaseConnection,
    legacy: &DatabaseConnection,
) -> Result<LegacyImportReport, DbErr> {
    let legacy_clubs = load_legacy_clubs(legacy).await?;
    let legacy_rooms = load_legacy_rooms(legacy).await?;
    let legacy_club_members = load_legacy_club_members(legacy).await?;
    let legacy_room_members = load_legacy_room_members(legacy).await?;
    let legacy_public_threads = load_legacy_public_threads(legacy).await?;
    let legacy_club_threads = load_legacy_club_threads(legacy).await?;
    let legacy_room_threads = load_legacy_room_threads(legacy).await?;
    let legacy_comments = load_legacy_comments(legacy).await?;
    let legacy_thread_votes = load_legacy_thread_votes(legacy).await?;
    let legacy_comment_votes = load_legacy_comment_votes(legacy).await?;
    let legacy_thread_tags = load_legacy_thread_tags(legacy).await?;
    let legacy_thread_views = load_legacy_thread_views(legacy).await?;
    let legacy_edit_history = load_legacy_edit_history(legacy).await?;

    if legacy_clubs.is_empty()
        && legacy_rooms.is_empty()
        && legacy_public_threads.is_empty()
        && legacy_club_threads.is_empty()
        && legacy_room_threads.is_empty()
    {
        info!("legacy import skipped: no legacy social data found");
        return Ok(LegacyImportReport::default());
    }

    let tx = target.begin().await?;
    let mut report = LegacyImportReport::default();

    let current_clubs = clubs::Entity::find().all(&tx).await?;
    let mut clubs_by_id: HashMap<Uuid, clubs::Model> = current_clubs
        .into_iter()
        .map(|club| (club.id, club))
        .collect();
    let mut clubs_by_slug: HashMap<String, Uuid> = clubs_by_id
        .values()
        .map(|club| (club.slug.clone(), club.id))
        .collect();
    let mut taken_slugs: HashSet<String> = clubs_by_slug.keys().cloned().collect();

    let mut legacy_public_to_target: HashMap<Uuid, Uuid> = HashMap::new();
    for legacy_club in &legacy_clubs {
        if let Some(existing_id) = clubs_by_slug.get(&legacy_club.slug).copied() {
            legacy_public_to_target.insert(legacy_club.id, existing_id);
            let existing = clubs_by_id
                .get(&existing_id)
                .cloned()
                .ok_or_else(|| DbErr::Custom("club slug map points to missing id".into()))?;
            if let Some(updated) = merge_public_club(&tx, existing, legacy_club).await? {
                report.public_clubs_merged += 1;
                clubs_by_id.insert(updated.id, updated.clone());
                clubs_by_slug.insert(updated.slug.clone(), updated.id);
            }
            continue;
        }

        if let Some(existing) = clubs_by_id.get(&legacy_club.id).cloned() {
            legacy_public_to_target.insert(legacy_club.id, existing.id);
            if let Some(updated) = merge_public_club(&tx, existing, legacy_club).await? {
                report.public_clubs_merged += 1;
                clubs_by_id.insert(updated.id, updated.clone());
                clubs_by_slug.insert(updated.slug.clone(), updated.id);
            }
            continue;
        }

        let inserted = clubs::ActiveModel {
            id: Set(legacy_club.id),
            name: Set(legacy_club.name.clone()),
            slug: Set(legacy_club.slug.clone()),
            description: Set(legacy_club.description.clone()),
            category: Set(legacy_club.category.clone()),
            is_public: Set(legacy_club.is_public),
            creator_id: Set(legacy_club.creator_id),
            avatar_url: Set(None),
            cover_image_url: Set(legacy_club.cover_image_url.clone()),
            rules: Set(legacy_club.rules_json.clone()),
            address: Set(legacy_club.address.clone()),
            latitude: Set(legacy_club.latitude),
            longitude: Set(legacy_club.longitude),
            member_count: Set(0),
            created_at: Set(legacy_club.created_at),
            updated_at: Set(legacy_club.updated_at),
        }
        .insert(&tx)
        .await?;

        report.public_clubs_inserted += 1;
        taken_slugs.insert(inserted.slug.clone());
        clubs_by_slug.insert(inserted.slug.clone(), inserted.id);
        clubs_by_id.insert(inserted.id, inserted.clone());
        legacy_public_to_target.insert(legacy_club.id, inserted.id);
    }

    let mut legacy_room_to_target: HashMap<Uuid, Uuid> = HashMap::new();
    for legacy_room in &legacy_rooms {
        if clubs_by_id.contains_key(&legacy_room.id) {
            legacy_room_to_target.insert(legacy_room.id, legacy_room.id);
            continue;
        }

        let slug = reserve_room_slug(&legacy_room.name, legacy_room.id, &mut taken_slugs);
        let inserted = clubs::ActiveModel {
            id: Set(legacy_room.id),
            name: Set(legacy_room.name.clone()),
            slug: Set(slug.clone()),
            description: Set(legacy_room.description.clone()),
            category: Set(None),
            is_public: Set(legacy_room.visibility == "public"),
            creator_id: Set(legacy_room.owner_id),
            avatar_url: Set(None),
            cover_image_url: Set(None),
            rules: Set(None),
            address: Set(None),
            latitude: Set(None),
            longitude: Set(None),
            member_count: Set(0),
            created_at: Set(legacy_room.created_at),
            updated_at: Set(legacy_room.updated_at),
        }
        .insert(&tx)
        .await?;

        report.private_rooms_inserted += 1;
        clubs_by_slug.insert(slug, inserted.id);
        clubs_by_id.insert(inserted.id, inserted.clone());
        legacy_room_to_target.insert(legacy_room.id, inserted.id);
    }

    let existing_memberships = club_members::Entity::find().all(&tx).await?;
    let mut memberships_by_key: HashMap<(Uuid, Uuid), club_members::Model> = existing_memberships
        .into_iter()
        .map(|membership| ((membership.club_id, membership.user_id), membership))
        .collect();

    let mut desired_memberships: HashMap<(Uuid, Uuid), DesiredMembership> = HashMap::new();
    for membership in &legacy_club_members {
        let Some(&target_club_id) = legacy_public_to_target.get(&membership.club_id) else {
            continue;
        };
        merge_desired_membership(
            &mut desired_memberships,
            DesiredMembership {
                club_id: target_club_id,
                user_id: membership.user_id,
                role: normalize_legacy_club_role(&membership.role),
                joined_at: membership.joined_at,
            },
        );
    }

    for room in &legacy_rooms {
        let Some(&target_club_id) = legacy_room_to_target.get(&room.id) else {
            continue;
        };
        merge_desired_membership(
            &mut desired_memberships,
            DesiredMembership {
                club_id: target_club_id,
                user_id: room.owner_id,
                role: "owner".into(),
                joined_at: room.created_at,
            },
        );
    }

    for membership in &legacy_room_members {
        let Some(&target_club_id) = legacy_room_to_target.get(&membership.room_id) else {
            continue;
        };
        merge_desired_membership(
            &mut desired_memberships,
            DesiredMembership {
                club_id: target_club_id,
                user_id: membership.user_id,
                role: "member".into(),
                joined_at: membership.joined_at,
            },
        );
    }

    let mut affected_club_ids: HashSet<Uuid> = HashSet::new();
    for desired in desired_memberships.into_values() {
        affected_club_ids.insert(desired.club_id);
        let key = (desired.club_id, desired.user_id);
        if let Some(existing) = memberships_by_key.get(&key).cloned() {
            let target_role = if role_rank(&desired.role) > role_rank(&existing.role) {
                desired.role.clone()
            } else {
                existing.role.clone()
            };
            let target_joined_at = existing.joined_at.min(desired.joined_at);

            if target_role != existing.role || target_joined_at != existing.joined_at {
                let mut active: club_members::ActiveModel = existing.into();
                active.role = Set(target_role);
                active.joined_at = Set(target_joined_at);
                let updated = active.update(&tx).await?;
                memberships_by_key.insert(key, updated);
                report.memberships_updated += 1;
            }
            continue;
        }

        let inserted = club_members::ActiveModel {
            club_id: Set(desired.club_id),
            user_id: Set(desired.user_id),
            role: Set(desired.role),
            joined_at: Set(desired.joined_at),
        }
        .insert(&tx)
        .await?;

        memberships_by_key.insert(key, inserted);
        report.memberships_inserted += 1;
    }

    for club_id in affected_club_ids {
        let member_count = i32::try_from(
            memberships_by_key
                .values()
                .filter(|membership| membership.club_id == club_id)
                .count(),
        )
        .map_err(|_| DbErr::Custom("club membership count exceeds i32".into()))?;
        clubs::Entity::update_many()
            .filter(clubs::Column::Id.eq(club_id))
            .col_expr(clubs::Column::MemberCount, Expr::value(member_count))
            .exec(&tx)
            .await?;
    }

    let mut current_thread_ids: HashSet<Uuid> = threads::Entity::find()
        .all(&tx)
        .await?
        .into_iter()
        .map(|thread| thread.id)
        .collect();

    for thread in &legacy_public_threads {
        if current_thread_ids.contains(&thread.id) {
            continue;
        }
        insert_public_thread(&tx, thread).await?;
        current_thread_ids.insert(thread.id);
        report.threads_inserted += 1;
    }

    for thread in &legacy_club_threads {
        if current_thread_ids.contains(&thread.id) {
            continue;
        }
        let Some(&target_club_id) = legacy_public_to_target.get(&thread.club_id) else {
            continue;
        };
        insert_discussion_thread(
            &tx,
            thread.id,
            target_club_id,
            thread.author_id,
            &thread.title,
            &thread.content,
            thread.content_html.clone(),
            thread.is_pinned,
            thread.is_locked,
            thread.reply_count,
            thread.score,
            thread.is_hidden,
            thread.language.clone(),
            thread.created_at,
            thread.updated_at,
        )
        .await?;
        current_thread_ids.insert(thread.id);
        report.threads_inserted += 1;
    }

    for thread in &legacy_room_threads {
        if current_thread_ids.contains(&thread.id) {
            continue;
        }
        let Some(&target_club_id) = legacy_room_to_target.get(&thread.room_id) else {
            continue;
        };
        insert_discussion_thread(
            &tx,
            thread.id,
            target_club_id,
            thread.author_id,
            &thread.title,
            &thread.content,
            thread.content_html.clone(),
            thread.is_pinned,
            thread.is_locked,
            thread.reply_count,
            thread.score,
            thread.is_hidden,
            None,
            thread.created_at,
            thread.updated_at,
        )
        .await?;
        current_thread_ids.insert(thread.id);
        report.threads_inserted += 1;
    }

    let current_comments = comments::Entity::find().all(&tx).await?;
    let mut current_comment_ids: HashSet<Uuid> =
        current_comments.iter().map(|comment| comment.id).collect();
    let current_comment_depths: HashMap<Uuid, i32> = current_comments
        .into_iter()
        .map(|comment| (comment.id, comment.depth))
        .collect();

    let comment_depths = compute_comment_depths(&legacy_comments, &current_comment_depths)?;
    let mut pending_comments: Vec<(&LegacyComment, i32)> = legacy_comments
        .iter()
        .filter_map(|comment| {
            if current_comment_ids.contains(&comment.id)
                || !current_thread_ids.contains(&comment.thread_id)
            {
                return None;
            }

            let depth = match comment.depth {
                Some(depth) => depth,
                None => *comment_depths.get(&comment.id)?,
            };
            Some((comment, depth))
        })
        .collect();
    pending_comments.sort_by_key(|(comment, depth)| (*depth, comment.created_at, comment.id));

    for (comment, depth) in pending_comments {
        comments::ActiveModel {
            id: Set(comment.id),
            thread_id: Set(comment.thread_id),
            parent_id: Set(comment.parent_id),
            author_id: Set(comment.author_id),
            content: Set(comment.content.clone()),
            content_html: Set(comment.content_html.clone()),
            depth: Set(depth),
            score: Set(comment.score),
            language: Set(comment.language.clone()),
            is_hidden: Set(comment.is_hidden),
            deleted_at: Set(None),
            created_at: Set(comment.created_at),
            updated_at: Set(comment.updated_at),
        }
        .insert(&tx)
        .await?;

        current_comment_ids.insert(comment.id);
        report.comments_inserted += 1;
    }

    let mut current_thread_vote_keys: HashSet<(Uuid, Uuid)> = thread_votes::Entity::find()
        .all(&tx)
        .await?
        .into_iter()
        .map(|vote| (vote.thread_id, vote.user_id))
        .collect();
    for vote in &legacy_thread_votes {
        let key = (vote.thread_id, vote.user_id);
        if current_thread_vote_keys.contains(&key) || !current_thread_ids.contains(&vote.thread_id)
        {
            continue;
        }
        thread_votes::ActiveModel {
            thread_id: Set(vote.thread_id),
            user_id: Set(vote.user_id),
            value: Set(vote.value),
            created_at: Set(vote.created_at),
        }
        .insert(&tx)
        .await?;
        current_thread_vote_keys.insert(key);
        report.thread_votes_inserted += 1;
    }

    let mut current_comment_vote_keys: HashSet<(Uuid, Uuid)> = comment_votes::Entity::find()
        .all(&tx)
        .await?
        .into_iter()
        .map(|vote| (vote.comment_id, vote.user_id))
        .collect();
    for vote in &legacy_comment_votes {
        let key = (vote.comment_id, vote.user_id);
        if current_comment_vote_keys.contains(&key)
            || !current_comment_ids.contains(&vote.comment_id)
        {
            continue;
        }
        comment_votes::ActiveModel {
            comment_id: Set(vote.comment_id),
            user_id: Set(vote.user_id),
            value: Set(vote.value),
            created_at: Set(vote.created_at),
        }
        .insert(&tx)
        .await?;
        current_comment_vote_keys.insert(key);
        report.comment_votes_inserted += 1;
    }

    let mut current_thread_tag_keys: HashSet<(Uuid, String)> = thread_tags::Entity::find()
        .all(&tx)
        .await?
        .into_iter()
        .map(|tag| (tag.thread_id, tag.tag))
        .collect();
    for tag in &legacy_thread_tags {
        let key = (tag.thread_id, tag.tag.clone());
        if current_thread_tag_keys.contains(&key) || !current_thread_ids.contains(&tag.thread_id) {
            continue;
        }
        thread_tags::ActiveModel {
            thread_id: Set(tag.thread_id),
            tag: Set(tag.tag.clone()),
        }
        .insert(&tx)
        .await?;
        current_thread_tag_keys.insert(key);
        report.thread_tags_inserted += 1;
    }

    let mut current_thread_view_keys: HashSet<(Uuid, Uuid)> = thread_views::Entity::find()
        .all(&tx)
        .await?
        .into_iter()
        .map(|view| (view.thread_id, view.user_id))
        .collect();
    for view in &legacy_thread_views {
        let key = (view.thread_id, view.user_id);
        if current_thread_view_keys.contains(&key) || !current_thread_ids.contains(&view.thread_id)
        {
            continue;
        }
        thread_views::ActiveModel {
            thread_id: Set(view.thread_id),
            user_id: Set(view.user_id),
            viewed_at: Set(view.viewed_at),
        }
        .insert(&tx)
        .await?;
        current_thread_view_keys.insert(key);
        report.thread_views_inserted += 1;
    }

    let mut current_edit_history_ids: HashSet<Uuid> = edit_history::Entity::find()
        .all(&tx)
        .await?
        .into_iter()
        .map(|entry| entry.id)
        .collect();
    for entry in &legacy_edit_history {
        if current_edit_history_ids.contains(&entry.id)
            || entry.content_type != "thread"
            || !current_thread_ids.contains(&entry.content_id)
        {
            continue;
        }
        edit_history::ActiveModel {
            id: Set(entry.id),
            content_type: Set(entry.content_type.clone()),
            content_id: Set(entry.content_id),
            edited_by: Set(entry.edited_by),
            previous_content: Set(entry.previous_content.clone()),
            previous_content_html: Set(entry.previous_content_html.clone()),
            previous_title: Set(entry.previous_title.clone()),
            edited_at: Set(entry.edited_at),
        }
        .insert(&tx)
        .await?;
        current_edit_history_ids.insert(entry.id);
        report.edit_history_inserted += 1;
    }

    tx.commit().await?;
    info!(?report, "legacy import complete");
    Ok(report)
}

async fn merge_public_club<C: ConnectionTrait>(
    db: &C,
    existing: clubs::Model,
    legacy: &LegacyClub,
) -> Result<Option<clubs::Model>, DbErr> {
    let mut changed = false;
    let mut active: clubs::ActiveModel = existing.clone().into();

    if existing.description.is_none() && legacy.description.is_some() {
        active.description = Set(legacy.description.clone());
        changed = true;
    }
    if existing.category.is_none() && legacy.category.is_some() {
        active.category = Set(legacy.category.clone());
        changed = true;
    }
    if !existing.is_public && legacy.is_public {
        active.is_public = Set(true);
        changed = true;
    }
    if existing.cover_image_url.is_none() && legacy.cover_image_url.is_some() {
        active.cover_image_url = Set(legacy.cover_image_url.clone());
        changed = true;
    }
    if existing.rules.is_none() && legacy.rules_json.is_some() {
        active.rules = Set(legacy.rules_json.clone());
        changed = true;
    }
    if existing.address.is_none() && legacy.address.is_some() {
        active.address = Set(legacy.address.clone());
        changed = true;
    }
    if existing.latitude.is_none() && legacy.latitude.is_some() {
        active.latitude = Set(legacy.latitude);
        changed = true;
    }
    if existing.longitude.is_none() && legacy.longitude.is_some() {
        active.longitude = Set(legacy.longitude);
        changed = true;
    }

    if !changed {
        return Ok(None);
    }

    active.updated_at = Set(existing.updated_at.max(legacy.updated_at));
    active.member_count = Set(existing.member_count);
    let updated = active.update(db).await?;
    Ok(Some(updated))
}

async fn insert_public_thread<C: ConnectionTrait>(
    db: &C,
    thread: &LegacyPublicThread,
) -> Result<(), DbErr> {
    threads::ActiveModel {
        id: Set(thread.id),
        title: Set(thread.title.clone()),
        content: Set(thread.content.clone()),
        content_html: Set(thread.content_html.clone()),
        author_id: Set(thread.author_id),
        scope: Set(thread.scope.clone()),
        country: Set(thread.country.clone()),
        municipality_id: Set(thread.municipality_id),
        location_id: Set(thread.location_id),
        place_id: Set(thread.place_id),
        latitude: Set(thread.latitude),
        longitude: Set(thread.longitude),
        institutional_context: Set(thread.institutional_context.clone()),
        is_pinned: Set(thread.is_pinned),
        is_locked: Set(thread.is_locked),
        reply_count: Set(thread.reply_count),
        score: Set(thread.score),
        view_count: Set(thread.view_count),
        source: Set(thread.source.clone()),
        source_url: Set(thread.source_url.clone()),
        source_id: Set(thread.source_id.clone()),
        source_institution_id: Set(thread.source_institution_id),
        ai_generated: Set(thread.ai_generated),
        ai_model: Set(thread.ai_model.clone()),
        language: Set(thread.language.clone()),
        is_hidden: Set(thread.is_hidden),
        club_id: Set(None),
        deleted_at: Set(None),
        created_at: Set(thread.created_at),
        updated_at: Set(thread.updated_at),
    }
    .insert(db)
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn insert_discussion_thread<C: ConnectionTrait>(
    db: &C,
    id: Uuid,
    club_id: Uuid,
    author_id: Uuid,
    title: &str,
    content: &str,
    content_html: Option<String>,
    is_pinned: bool,
    is_locked: bool,
    reply_count: i32,
    score: i32,
    is_hidden: bool,
    language: Option<String>,
    created_at: DateTimeWithTimeZone,
    updated_at: DateTimeWithTimeZone,
) -> Result<(), DbErr> {
    threads::ActiveModel {
        id: Set(id),
        title: Set(title.to_owned()),
        content: Set(content.to_owned()),
        content_html: Set(content_html),
        author_id: Set(author_id),
        scope: Set("club".into()),
        country: Set(None),
        municipality_id: Set(None),
        location_id: Set(None),
        place_id: Set(None),
        latitude: Set(None),
        longitude: Set(None),
        institutional_context: Set(None),
        is_pinned: Set(is_pinned),
        is_locked: Set(is_locked),
        reply_count: Set(reply_count),
        score: Set(score),
        view_count: Set(0),
        source: Set("user".into()),
        source_url: Set(None),
        source_id: Set(None),
        source_institution_id: Set(None),
        ai_generated: Set(false),
        ai_model: Set(None),
        language: Set(language),
        is_hidden: Set(is_hidden),
        club_id: Set(Some(club_id)),
        deleted_at: Set(None),
        created_at: Set(created_at),
        updated_at: Set(updated_at),
    }
    .insert(db)
    .await?;
    Ok(())
}

fn merge_desired_membership(
    desired_memberships: &mut HashMap<(Uuid, Uuid), DesiredMembership>,
    candidate: DesiredMembership,
) {
    let key = (candidate.club_id, candidate.user_id);
    match desired_memberships.get_mut(&key) {
        Some(existing) => {
            if role_rank(&candidate.role) > role_rank(&existing.role) {
                existing.role = candidate.role;
            }
            existing.joined_at = existing.joined_at.min(candidate.joined_at);
        }
        None => {
            desired_memberships.insert(key, candidate);
        }
    }
}

fn normalize_legacy_club_role(role: &str) -> String {
    match role {
        "admin" | "owner" => "owner".into(),
        "moderator" => "moderator".into(),
        _ => "member".into(),
    }
}

fn role_rank(role: &str) -> u8 {
    match role {
        "owner" => 3,
        "moderator" => 2,
        _ => 1,
    }
}

fn slugify(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn reserve_room_slug(name: &str, room_id: Uuid, taken: &mut HashSet<String>) -> String {
    let base = slugify(name);
    let base = if base.is_empty() {
        "room".to_string()
    } else {
        base
    };

    let short = room_id.simple().to_string();
    for candidate in [
        base.clone(),
        format!("{base}-room"),
        format!("{base}-{}", &short[..8]),
        format!("{base}-{short}"),
    ] {
        if taken.insert(candidate.clone()) {
            return candidate;
        }
    }

    unreachable!("room slug candidates exhausted")
}

fn compute_comment_depths(
    comments: &[LegacyComment],
    existing_depths: &HashMap<Uuid, i32>,
) -> Result<HashMap<Uuid, i32>, DbErr> {
    let by_id: HashMap<Uuid, &LegacyComment> = comments
        .iter()
        .map(|comment| (comment.id, comment))
        .collect();
    let mut computed = HashMap::new();
    let mut visiting = HashSet::new();

    for comment in comments {
        compute_comment_depth(
            comment.id,
            &by_id,
            existing_depths,
            &mut computed,
            &mut visiting,
        )?;
    }

    Ok(computed)
}

fn compute_comment_depth(
    id: Uuid,
    by_id: &HashMap<Uuid, &LegacyComment>,
    existing_depths: &HashMap<Uuid, i32>,
    computed: &mut HashMap<Uuid, i32>,
    visiting: &mut HashSet<Uuid>,
) -> Result<i32, DbErr> {
    if let Some(depth) = computed.get(&id).copied() {
        return Ok(depth);
    }

    if !visiting.insert(id) {
        return Err(DbErr::Custom(
            "legacy comments contain a parent cycle".into(),
        ));
    }

    let Some(comment) = by_id.get(&id).copied() else {
        visiting.remove(&id);
        return Ok(0);
    };

    let depth = if let Some(depth) = comment.depth {
        depth
    } else if let Some(parent_id) = comment.parent_id {
        if let Some(parent_depth) = existing_depths.get(&parent_id).copied() {
            parent_depth + 1
        } else {
            compute_comment_depth(parent_id, by_id, existing_depths, computed, visiting)? + 1
        }
    } else {
        0
    };

    visiting.remove(&id);
    computed.insert(id, depth);
    Ok(depth)
}

async fn load_legacy_clubs(legacy: &DatabaseConnection) -> Result<Vec<LegacyClub>, DbErr> {
    LegacyClub::find_by_statement(raw_statement(
        "SELECT id, name, slug, description, category, creator_id, to_json(rules)::text AS rules_json, cover_image_url, is_public, latitude, longitude, address, created_at, updated_at FROM clubs ORDER BY created_at",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_rooms(legacy: &DatabaseConnection) -> Result<Vec<LegacyRoom>, DbErr> {
    LegacyRoom::find_by_statement(raw_statement(
        "SELECT id, owner_id, name, description, visibility::text AS visibility, created_at, updated_at FROM rooms ORDER BY created_at",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_club_members(
    legacy: &DatabaseConnection,
) -> Result<Vec<LegacyClubMembership>, DbErr> {
    LegacyClubMembership::find_by_statement(raw_statement(
        "SELECT club_id, user_id, role::text AS role, joined_at FROM club_members ORDER BY joined_at",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_room_members(
    legacy: &DatabaseConnection,
) -> Result<Vec<LegacyRoomMembership>, DbErr> {
    LegacyRoomMembership::find_by_statement(raw_statement(
        "SELECT room_id, user_id, joined_at FROM room_members ORDER BY joined_at",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_public_threads(
    legacy: &DatabaseConnection,
) -> Result<Vec<LegacyPublicThread>, DbErr> {
    LegacyPublicThread::find_by_statement(raw_statement(
        "SELECT id, title, content, content_html, author_id, scope::text AS scope, country, municipality_id, location_id, place_id, latitude, longitude, institutional_context, is_pinned, is_locked, reply_count, score, view_count, source::text AS source, source_url, source_id, source_institution_id, ai_generated, ai_model, language, is_hidden, created_at, updated_at FROM threads ORDER BY created_at",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_club_threads(
    legacy: &DatabaseConnection,
) -> Result<Vec<LegacyClubThread>, DbErr> {
    LegacyClubThread::find_by_statement(raw_statement(
        "SELECT id, club_id, author_id, title, content, content_html, is_pinned, is_locked, reply_count, score, is_hidden, language, created_at, updated_at FROM club_threads ORDER BY created_at",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_room_threads(
    legacy: &DatabaseConnection,
) -> Result<Vec<LegacyRoomThread>, DbErr> {
    LegacyRoomThread::find_by_statement(raw_statement(
        "SELECT id, room_id, author_id, title, content, content_html, is_pinned, is_locked, reply_count, score, is_hidden, created_at, updated_at FROM room_threads ORDER BY created_at",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_comments(legacy: &DatabaseConnection) -> Result<Vec<LegacyComment>, DbErr> {
    LegacyComment::find_by_statement(raw_statement(
        "SELECT id, thread_id, parent_id, author_id, content, content_html, depth, score, is_hidden, language, created_at, updated_at FROM comments
         UNION ALL
         SELECT id, thread_id, parent_id, author_id, content, content_html, NULL::integer AS depth, score, is_hidden, language, created_at, updated_at FROM club_comments
         UNION ALL
         SELECT id, thread_id, parent_id, author_id, content, content_html, NULL::integer AS depth, score, is_hidden, NULL::varchar AS language, created_at, updated_at FROM room_comments",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_thread_votes(
    legacy: &DatabaseConnection,
) -> Result<Vec<LegacyThreadVote>, DbErr> {
    LegacyThreadVote::find_by_statement(raw_statement(
        "SELECT thread_id, user_id, value::smallint AS value, created_at FROM thread_votes
         UNION ALL
         SELECT thread_id, user_id, value::smallint AS value, created_at FROM club_thread_votes
         UNION ALL
         SELECT thread_id, user_id, value::smallint AS value, created_at FROM room_thread_votes",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_comment_votes(
    legacy: &DatabaseConnection,
) -> Result<Vec<LegacyCommentVote>, DbErr> {
    LegacyCommentVote::find_by_statement(raw_statement(
        "SELECT comment_id, user_id, value::smallint AS value, created_at FROM comment_votes
         UNION ALL
         SELECT comment_id, user_id, value::smallint AS value, created_at FROM club_comment_votes
         UNION ALL
         SELECT comment_id, user_id, value::smallint AS value, created_at FROM room_comment_votes",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_thread_tags(
    legacy: &DatabaseConnection,
) -> Result<Vec<LegacyThreadTag>, DbErr> {
    LegacyThreadTag::find_by_statement(raw_statement(
        "SELECT thread_id, tag FROM thread_tags ORDER BY thread_id, tag",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_thread_views(
    legacy: &DatabaseConnection,
) -> Result<Vec<LegacyThreadView>, DbErr> {
    LegacyThreadView::find_by_statement(raw_statement(
        "SELECT thread_id, user_id, MAX(created_at) AS viewed_at FROM thread_views WHERE user_id IS NOT NULL GROUP BY thread_id, user_id",
    ))
    .all(legacy)
    .await
}

async fn load_legacy_edit_history(
    legacy: &DatabaseConnection,
) -> Result<Vec<LegacyEditHistory>, DbErr> {
    LegacyEditHistory::find_by_statement(raw_statement(
        "SELECT id, content_type::text AS content_type, content_id, edited_by, previous_content, previous_content_html, previous_title, edited_at FROM edit_history WHERE content_type::text = 'thread' ORDER BY edited_at",
    ))
    .all(legacy)
    .await
}

fn raw_statement(sql: &str) -> Statement {
    Statement::from_string(DatabaseBackend::Postgres, sql.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{compute_comment_depths, normalize_legacy_club_role, reserve_room_slug};
    use std::collections::{HashMap, HashSet};
    use uuid::Uuid;

    use super::LegacyComment;

    #[test]
    fn normalizes_legacy_admin_role_to_owner() {
        assert_eq!(normalize_legacy_club_role("admin"), "owner");
        assert_eq!(normalize_legacy_club_role("member"), "member");
    }

    #[test]
    fn room_slug_is_reserved_deterministically() {
        let room_id = Uuid::parse_str("71d3df95-bf48-494c-8509-e2215f399b8e").unwrap();
        let mut taken = HashSet::from([String::from("markuksen-kotiketju")]);
        let slug = reserve_room_slug("Markuksen kotiketju", room_id, &mut taken);
        assert_eq!(slug, "markuksen-kotiketju-room");
    }

    #[test]
    fn computes_depths_for_nested_legacy_comments() {
        let thread_id = Uuid::nil();
        let root_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let child_id = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();
        let grandchild_id = Uuid::parse_str("00000000-0000-0000-0000-000000000003").unwrap();
        let author_id = Uuid::parse_str("00000000-0000-0000-0000-000000000010").unwrap();
        let now = chrono::DateTime::parse_from_rfc3339("2026-04-07T00:00:00+00:00").unwrap();

        let comments = vec![
            LegacyComment {
                id: root_id,
                thread_id,
                parent_id: None,
                author_id,
                content: "root".into(),
                content_html: None,
                depth: None,
                score: 0,
                is_hidden: false,
                language: None,
                created_at: now,
                updated_at: now,
            },
            LegacyComment {
                id: child_id,
                thread_id,
                parent_id: Some(root_id),
                author_id,
                content: "child".into(),
                content_html: None,
                depth: None,
                score: 0,
                is_hidden: false,
                language: None,
                created_at: now,
                updated_at: now,
            },
            LegacyComment {
                id: grandchild_id,
                thread_id,
                parent_id: Some(child_id),
                author_id,
                content: "grandchild".into(),
                content_html: None,
                depth: None,
                score: 0,
                is_hidden: false,
                language: None,
                created_at: now,
                updated_at: now,
            },
        ];

        let depths = compute_comment_depths(&comments, &HashMap::new()).unwrap();
        assert_eq!(depths.get(&root_id), Some(&0));
        assert_eq!(depths.get(&child_id), Some(&1));
        assert_eq!(depths.get(&grandchild_id), Some(&2));
    }
}
