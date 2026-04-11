use sea_orm_migration::prelude::*;

/// Remove municipalities with no `official_code` that were created outside the
/// StatFi seed (accent-stripped duplicates and welfare service areas).
///
/// Threads referencing accent-stripped duplicates are re-pointed to the canonical
/// municipality (matched by `official_code`). Threads referencing welfare areas
/// (hyvinvointialue) have their `municipality_id` cleared — those institutions are
/// not geographic municipalities and will be modelled separately in the future
/// (see local/epic-geo-hierarchy-institutions.md).
pub struct Migration;

impl MigrationName for Migration {
    #[allow(clippy::unnecessary_literal_bound)]
    fn name(&self) -> &str {
        "m20260408_000020_clean_municipality_duplicates"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Re-point accent-stripped duplicates to canonical municipalities.
        // Subquery finds the canonical row by official_code; if it doesn't exist
        // (already clean environment) the UPDATE affects 0 rows safely.
        manager
            .get_connection()
            .execute_unprepared(
                r"
                UPDATE threads
                SET municipality_id = (
                    SELECT id FROM municipalities WHERE official_code = '186' LIMIT 1
                )
                WHERE municipality_id = (
                    SELECT id FROM municipalities WHERE name = 'Jarvenpaa' AND official_code IS NULL LIMIT 1
                )
                AND EXISTS (SELECT 1 FROM municipalities WHERE official_code = '186');
                ",
            )
            .await?;

        manager
            .get_connection()
            .execute_unprepared(
                r"
                UPDATE threads
                SET municipality_id = (
                    SELECT id FROM municipalities WHERE official_code = '507' LIMIT 1
                )
                WHERE municipality_id = (
                    SELECT id FROM municipalities WHERE name = 'Mantyharju' AND official_code IS NULL LIMIT 1
                )
                AND EXISTS (SELECT 1 FROM municipalities WHERE official_code = '507');
                ",
            )
            .await?;

        // Welfare areas and remaining code-less rows: clear municipality_id on
        // any threads still pointing to them, then delete the rows.
        manager
            .get_connection()
            .execute_unprepared(
                r"
                UPDATE threads
                SET municipality_id = NULL
                WHERE municipality_id IN (
                    SELECT id FROM municipalities WHERE official_code IS NULL
                );

                DELETE FROM municipalities WHERE official_code IS NULL;
                ",
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Deleted municipality rows cannot be recovered by a down migration —
        // they were data quality issues with no authoritative source.
        // Threads that had municipality_id cleared will remain cleared.
        manager
            .get_connection()
            .execute_unprepared("SELECT 1") // no-op
            .await?;
        Ok(())
    }
}
