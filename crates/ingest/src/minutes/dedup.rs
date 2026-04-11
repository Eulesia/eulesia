//! Dedup lookup so we never re-publish the same agenda item twice.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use eulesia_common::types::ThreadSource;
use eulesia_db::entities::threads;

use crate::error::IngestError;

/// Return true if a thread with `source='minutes_import'` and the given
/// `source_id` already exists. The source IDs are deterministic (slug +
/// body + doc + item number) so a re-run of the same meeting is a no-op.
pub async fn is_already_imported(
    db: &DatabaseConnection,
    source_id: &str,
) -> Result<bool, IngestError> {
    let existing = threads::Entity::find()
        .filter(threads::Column::Source.eq(ThreadSource::MinutesImport.as_str()))
        .filter(threads::Column::SourceId.eq(source_id))
        .one(db)
        .await
        .map_err(|source| IngestError::Database {
            context: "dedup lookup",
            source,
        })?;
    Ok(existing.is_some())
}
