//! Turn a drafted article into a persisted Agora thread.

use chrono::Utc;
use sea_orm::{ActiveValue::Set, DatabaseConnection};
use tracing::info;
use uuid::Uuid;

use eulesia_common::types::{ThreadSource, new_id};
use eulesia_db::entities::threads;
use eulesia_db::repo::{outbox_helpers, tags::TagRepo, threads::ThreadRepo};
use eulesia_db::seed::EULESIA_SUMMARY_USER_ID;

use crate::ai::ArticleDraft;
use crate::ai::prompts_fi::{DEFAULT_TAG, FOOTER_TEMPLATE, KEY_POINTS_HEADER};
use crate::error::IngestError;
use crate::fetchers::{Meeting, MinuteSource};

/// Context for constructing a single thread. Kept as a struct to avoid
/// a `too_many_arguments` function signature.
pub struct ThreadContext<'a> {
    pub source: &'a MinuteSource,
    pub meeting: &'a Meeting,
    pub item_source_id: &'a str,
    pub institution_id: Uuid,
    pub municipality_id: Option<Uuid>,
    pub location_id: Option<Uuid>,
    /// Optional `places.id` resolved from AI location hints — set when the
    /// minutes mention a specific named location inside the kunta.
    pub place_id: Option<Uuid>,
    pub model_name: &'a str,
}

/// Persist an article as a new thread, attach tags, and emit an outbox event.
///
/// Returns the newly created thread ID.
pub async fn create_thread_from_article(
    db: &DatabaseConnection,
    article: &ArticleDraft,
    ctx: &ThreadContext<'_>,
) -> Result<Uuid, IngestError> {
    let now = Utc::now().fixed_offset();
    let thread_id = new_id();
    let content = build_content(article, &ctx.meeting.page_url);

    let mut tags: Vec<String> = article.tags.iter().map(|t| normalize_tag(t)).collect();
    tags.push(DEFAULT_TAG.to_string());
    tags.sort();
    tags.dedup();

    let model = threads::ActiveModel {
        id: Set(thread_id),
        title: Set(article.title.clone()),
        content: Set(content),
        content_html: Set(None),
        author_id: Set(EULESIA_SUMMARY_USER_ID),
        scope: Set("local".into()),
        country: Set(Some(ctx.source.country.clone())),
        municipality_id: Set(ctx.municipality_id),
        location_id: Set(ctx.location_id),
        place_id: Set(ctx.place_id),
        latitude: Set(None),
        longitude: Set(None),
        institutional_context: Set(None),
        is_pinned: Set(false),
        is_locked: Set(false),
        reply_count: Set(0),
        score: Set(0),
        view_count: Set(0),
        source: Set(ThreadSource::MinutesImport.as_str().to_string()),
        source_url: Set(Some(ctx.meeting.page_url.clone())),
        source_id: Set(Some(ctx.item_source_id.to_string())),
        source_institution_id: Set(Some(ctx.institution_id)),
        ai_generated: Set(true),
        ai_model: Set(Some(ctx.model_name.to_string())),
        language: Set(Some(ctx.source.language.clone())),
        is_hidden: Set(false),
        club_id: Set(None),
        deleted_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };

    let thread = ThreadRepo::create(db, model)
        .await
        .map_err(|source| IngestError::Database {
            context: "insert minutes thread",
            source,
        })?;

    TagRepo::add_tags(db, thread.id, &tags)
        .await
        .map_err(|source| IngestError::Database {
            context: "insert thread tags",
            source,
        })?;

    outbox_helpers::emit_event(
        db,
        "thread_created",
        serde_json::json!({
            "id": thread.id.to_string(),
            "source": ThreadSource::MinutesImport.as_str(),
            "municipality_id": ctx.municipality_id.map(|u| u.to_string()),
            "institution_id": ctx.institution_id.to_string(),
            "source_url": ctx.meeting.page_url,
        }),
    )
    .await
    .map_err(|source| IngestError::Database {
        context: "emit thread_created outbox",
        source,
    })?;

    info!(
        thread_id = %thread.id,
        title = %article.title,
        source = %ctx.source.entity_name,
        "created minutes thread"
    );
    Ok(thread.id)
}

/// Build the rendered thread content block with summary, key points infobox
/// and Mistral attribution footer. Matches the old Node.js markup.
fn build_content(article: &ArticleDraft, source_url: &str) -> String {
    let key_points_block = if article.key_points.is_empty() {
        String::new()
    } else {
        let points = article
            .key_points
            .iter()
            .map(|p| format!("- {p}"))
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n\n<div class=\"summary-keypoints\">\n\n{KEY_POINTS_HEADER}\n{points}\n\n</div>")
    };

    let footer = FOOTER_TEMPLATE.replace("{sourceUrl}", source_url);
    format!(
        "{summary}{key_points_block}\n\n<div class=\"summary-footer\">\n\n{footer}\n\n</div>",
        summary = article.summary,
    )
}

fn normalize_tag(tag: &str) -> String {
    tag.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_contains_summary_keypoints_and_footer() {
        let draft = ArticleDraft {
            title: "t".into(),
            summary: "Yhteenveto".into(),
            key_points: vec!["Kohta 1".into(), "Kohta 2".into()],
            tags: vec![],
            location_hints: vec![],
        };
        let html = build_content(&draft, "https://example.com/p");
        assert!(html.contains("Yhteenveto"));
        assert!(html.contains("summary-keypoints"));
        assert!(html.contains("Kohta 1"));
        assert!(html.contains("summary-footer"));
        assert!(html.contains("https://example.com/p"));
    }

    #[test]
    fn empty_key_points_skip_infobox() {
        let draft = ArticleDraft {
            title: "t".into(),
            summary: "Yhteenveto".into(),
            key_points: vec![],
            tags: vec![],
            location_hints: vec![],
        };
        let html = build_content(&draft, "https://example.com");
        assert!(!html.contains("summary-keypoints"));
        assert!(html.contains("summary-footer"));
    }

    #[test]
    fn tag_normalization_is_case_insensitive() {
        assert_eq!(normalize_tag("  Kaavoitus  "), "kaavoitus");
    }
}
