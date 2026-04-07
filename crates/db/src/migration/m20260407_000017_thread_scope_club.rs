use sea_orm_migration::prelude::*;

pub struct Migration;

const MIGRATION_NAME: &str = "m20260407_000017_thread_scope_club";

impl MigrationName for Migration {
    fn name(&self) -> &str {
        MIGRATION_NAME
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "
                ALTER TABLE threads DROP CONSTRAINT IF EXISTS chk_threads_scope;
                ALTER TABLE threads ADD CONSTRAINT chk_threads_scope CHECK (scope IN ('local', 'national', 'european', 'club'));
                ",
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "
                ALTER TABLE threads DROP CONSTRAINT IF EXISTS chk_threads_scope;
                ALTER TABLE threads ADD CONSTRAINT chk_threads_scope CHECK (scope IN ('local', 'national', 'european'));
                ",
            )
            .await?;
        Ok(())
    }
}
