//! Institution-placeholder and location helpers.
//!
//! Each municipality (or higher administrative entity) gets a dedicated
//! "institution" user account. The Eulesia Summary bot writes threads as
//! itself but attaches `source_institution_id = <that user>` so the
//! frontend can surface the right badge and users can follow the entity
//! directly.
//!
//! The account can later be "taken over" by the real institution when
//! they join the platform — at that point the `identity_provider` flips
//! from `"eulesia-bot"` to whatever real identity they use.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use tracing::info;
use uuid::Uuid;

use eulesia_common::types::new_id;
use eulesia_db::entities::{locations, municipalities, users};

use crate::error::IngestError;

/// Administrative level of an entity. Maps to the `users.institution_type`
/// column on the institution placeholder account.
#[derive(Debug, Clone, Copy)]
pub enum InstitutionKind {
    Municipality,
    Region,
}

impl InstitutionKind {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Municipality => "municipality",
            Self::Region => "region",
        }
    }
}

/// Look up a municipality by its display name.
///
/// Returns `Ok(None)` when no record matches — the importer should then log
/// a warning but still proceed (the thread just gets no `municipality_id`).
pub async fn find_municipality_by_name(
    db: &DatabaseConnection,
    name: &str,
    country: &str,
) -> Result<Option<municipalities::Model>, IngestError> {
    // Try exact name match first, then name_fi fallback.
    let by_name = municipalities::Entity::find()
        .filter(municipalities::Column::Country.eq(country))
        .filter(municipalities::Column::Name.eq(name))
        .one(db)
        .await
        .map_err(|source| IngestError::Database {
            context: "find_municipality name lookup",
            source,
        })?;
    if by_name.is_some() {
        return Ok(by_name);
    }

    let by_name_fi = municipalities::Entity::find()
        .filter(municipalities::Column::Country.eq(country))
        .filter(municipalities::Column::NameFi.eq(name))
        .one(db)
        .await
        .map_err(|source| IngestError::Database {
            context: "find_municipality name_fi lookup",
            source,
        })?;
    Ok(by_name_fi)
}

/// Get or create an institution placeholder account for an entity.
///
/// Lookup is by `institution_name` — stable across reruns since the display
/// name is the only consistent identifier we have from our source lists.
pub async fn get_or_create_institution(
    db: &DatabaseConnection,
    name: &str,
    kind: InstitutionKind,
    municipality_id: Option<Uuid>,
) -> Result<Uuid, IngestError> {
    // Try to find by institution_name first.
    if let Some(existing) = users::Entity::find()
        .filter(users::Column::Role.eq("institution"))
        .filter(users::Column::InstitutionName.eq(name))
        .filter(users::Column::DeletedAt.is_null())
        .one(db)
        .await
        .map_err(|source| IngestError::Database {
            context: "find institution by name",
            source,
        })?
    {
        return Ok(existing.id);
    }

    // Create a new placeholder.
    let slug = slugify_fi(name);
    let username = ensure_unique_username(db, &format!("inst-{slug}")).await?;
    let now = Utc::now().fixed_offset();

    let model = users::ActiveModel {
        id: Set(new_id()),
        username: Set(username.clone()),
        email: Set(None),
        password_hash: Set(None),
        name: Set(name.to_string()),
        avatar_url: Set(None),
        bio: Set(None),
        role: Set("institution".into()),
        institution_type: Set(Some(kind.as_str().to_string())),
        institution_name: Set(Some(name.to_string())),
        identity_verified: Set(false),
        identity_provider: Set(Some("eulesia-bot".into())),
        identity_level: Set("basic".into()),
        identity_issuer: Set(None),
        identity_verified_at: Set(None),
        verified_name: Set(None),
        rp_subject: Set(None),
        municipality_id: Set(municipality_id),
        locale: Set("fi".into()),
        notification_replies: Set(false),
        notification_mentions: Set(false),
        notification_official: Set(false),
        onboarding_completed_at: Set(None),
        deleted_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        last_seen_at: Set(None),
    };

    let created = model
        .insert(db)
        .await
        .map_err(|source| IngestError::Database {
            context: "insert institution placeholder",
            source,
        })?;

    info!(name = %name, username = %username, "created institution placeholder");
    Ok(created.id)
}

/// Resolve a location record for an entity name if one already exists.
///
/// Phase 1 only looks at the existing `locations` table — Nominatim
/// lookups will be added when we need them for non-seeded entities.
pub async fn resolve_location_for_entity(
    db: &DatabaseConnection,
    name: &str,
    country: &str,
) -> Result<Option<Uuid>, IngestError> {
    let existing = locations::Entity::find()
        .filter(locations::Column::Name.eq(name))
        .filter(locations::Column::Country.eq(country))
        .one(db)
        .await
        .map_err(|source| IngestError::Database {
            context: "find location",
            source,
        })?;
    Ok(existing.map(|l| l.id))
}

/// Slugify a Finnish name for use inside a username.
///
/// Replaces Finnish special characters with ASCII equivalents, collapses
/// anything that is not alphanumeric to `-`, trims leading/trailing
/// dashes, and clamps to 40 characters.
pub fn slugify_fi(name: &str) -> String {
    let lowered: String = name
        .chars()
        .flat_map(|c| {
            let replaced = match c {
                'ä' | 'Ä' => Some('a'),
                'ö' | 'Ö' => Some('o'),
                'å' | 'Å' => Some('a'),
                'ü' | 'Ü' => Some('u'),
                'é' | 'É' => Some('e'),
                _ => None,
            };
            replaced
                .map(|r| vec![r])
                .unwrap_or_else(|| c.to_lowercase().collect::<Vec<_>>())
        })
        .collect();

    let mut out = String::with_capacity(lowered.len());
    let mut prev_dash = true; // treat start as dash so we don't emit leading -
    for c in lowered.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.len() > 40 {
        out.truncate(40);
        while out.ends_with('-') {
            out.pop();
        }
    }
    out
}

/// Ensure the proposed username is not already taken. Appends a short
/// time-based suffix if it is.
async fn ensure_unique_username(
    db: &DatabaseConnection,
    candidate: &str,
) -> Result<String, IngestError> {
    let existing = users::Entity::find()
        .filter(users::Column::Username.eq(candidate))
        .one(db)
        .await
        .map_err(|source| IngestError::Database {
            context: "check username uniqueness",
            source,
        })?;

    if existing.is_none() {
        return Ok(candidate.to_string());
    }

    let suffix = Utc::now().timestamp_millis().to_string();
    let short = &suffix[suffix.len().saturating_sub(4)..];
    Ok(format!("{candidate}-{short}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_handles_finnish_chars() {
        assert_eq!(slugify_fi("Lappeenranta"), "lappeenranta");
        assert_eq!(slugify_fi("Jyväskylä"), "jyvaskyla");
        assert_eq!(slugify_fi("Ähtäri"), "ahtari");
        assert_eq!(slugify_fi("Åland"), "aland");
        assert_eq!(
            slugify_fi("Etelä-Karjalan hyvinvointialue"),
            "etela-karjalan-hyvinvointialue"
        );
    }

    #[test]
    fn slugify_collapses_whitespace_and_punctuation() {
        assert_eq!(slugify_fi("  Kunta  "), "kunta");
        assert_eq!(
            slugify_fi("Kaupunginhallitus 2021 - 2025"),
            "kaupunginhallitus-2021-2025"
        );
    }

    #[test]
    fn slugify_truncates_long_names() {
        let long = "x".repeat(100);
        let slug = slugify_fi(&long);
        assert!(slug.len() <= 40);
    }
}
