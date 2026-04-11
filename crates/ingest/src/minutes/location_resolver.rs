//! Resolve free-text location hints produced by the AI pipeline into
//! concrete database rows.
//!
//! When Mistral extracts phrases like `["Lauritsala", "Brahenkatu 5"]`
//! from a meeting excerpt, we try to find the most specific matching
//! row we can so the resulting thread attaches to the right geographic
//! hierarchy level:
//!
//! 1. **places** (most specific) — named POIs like parks, libraries,
//!    schools. Scoped by `municipality_id` to avoid cross-kunta matches.
//! 2. **locations** (mid level) — kaupunginosat, districts, villages.
//!    Matched globally by name because locations may not yet carry a
//!    municipality link.
//! 3. **fall-through** — nothing matched, thread keeps its default
//!    municipality-level attachment (`municipality_id` only).
//!
//! The first hint that resolves wins. Subsequent hints are reported for
//! observability but not used — a single thread can only attach to one
//! `place_id` / `location_id` in the current schema.

use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
};
use tracing::debug;
use uuid::Uuid;

use eulesia_db::entities::{locations, places};

use crate::error::IngestError;

/// What [`resolve_location_hints`] actually produced. All three fields are
/// independent — callers may use any combination.
#[derive(Debug, Clone, Default)]
pub struct ResolvedLocation {
    /// `places.id` if one of the hints matched a specific place row.
    pub place_id: Option<Uuid>,
    /// `locations.id` when no place matched but a location name did, or
    /// the default location passed in by the caller.
    pub location_id: Option<Uuid>,
    /// The hint string that won. Useful for logging.
    pub matched_hint: Option<String>,
}

/// Resolve a list of free-text hints against the database.
///
/// `municipality_id` scopes the `places` search so a hint like
/// "Kirjasto" doesn't match a library in a different kunta.
/// `default_location_id` is used as a fallback when nothing resolves —
/// pass the kunta-level location here.
pub async fn resolve_location_hints(
    db: &DatabaseConnection,
    hints: &[String],
    municipality_id: Option<Uuid>,
    default_location_id: Option<Uuid>,
) -> Result<ResolvedLocation, IngestError> {
    for hint in hints {
        let trimmed = hint.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(place_id) = try_match_place(db, trimmed, municipality_id).await? {
            debug!(hint = %trimmed, %place_id, "resolved hint to place");
            return Ok(ResolvedLocation {
                place_id: Some(place_id),
                location_id: default_location_id,
                matched_hint: Some(trimmed.to_string()),
            });
        }

        if let Some(location_id) = try_match_location(db, trimmed).await? {
            debug!(hint = %trimmed, %location_id, "resolved hint to location");
            return Ok(ResolvedLocation {
                place_id: None,
                location_id: Some(location_id),
                matched_hint: Some(trimmed.to_string()),
            });
        }
    }

    Ok(ResolvedLocation {
        place_id: None,
        location_id: default_location_id,
        matched_hint: None,
    })
}

/// Exact-match against `places.name`/`name_fi` scoped to the municipality.
async fn try_match_place(
    db: &DatabaseConnection,
    hint: &str,
    municipality_id: Option<Uuid>,
) -> Result<Option<Uuid>, IngestError> {
    let mut query = places::Entity::find();

    if let Some(mid) = municipality_id {
        query = query.filter(places::Column::MunicipalityId.eq(mid));
    }

    let name_conditions = Condition::any()
        .add(places::Column::Name.eq(hint))
        .add(places::Column::NameFi.eq(hint));

    let row = query
        .filter(name_conditions)
        .order_by_asc(places::Column::Name)
        .limit(1)
        .one(db)
        .await
        .map_err(|source| IngestError::Database {
            context: "match place by name",
            source,
        })?;
    Ok(row.map(|m| m.id))
}

/// Exact-match against `locations.name`/`name_fi`/`name_local`.
async fn try_match_location(
    db: &DatabaseConnection,
    hint: &str,
) -> Result<Option<Uuid>, IngestError> {
    let conditions = Condition::any()
        .add(locations::Column::Name.eq(hint))
        .add(locations::Column::NameFi.eq(hint))
        .add(locations::Column::NameLocal.eq(hint));

    let row = locations::Entity::find()
        .filter(conditions)
        .order_by_desc(locations::Column::AdminLevel)
        .limit(1)
        .one(db)
        .await
        .map_err(|source| IngestError::Database {
            context: "match location by name",
            source,
        })?;
    Ok(row.map(|m| m.id))
}
