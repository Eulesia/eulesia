use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            "CREATE TABLE IF NOT EXISTS device_pairing_tokens (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_by_device_id UUID NULL REFERENCES devices(id) ON DELETE SET NULL,
                code_hash TEXT NOT NULL UNIQUE,
                used_at TIMESTAMPTZ NULL,
                used_by_device_id UUID NULL REFERENCES devices(id) ON DELETE SET NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            )",
        )
        .await?;

        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_device_pairing_tokens_user ON device_pairing_tokens (user_id)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_device_pairing_tokens_expires_at ON device_pairing_tokens (expires_at)",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP TABLE IF EXISTS device_pairing_tokens")
            .await?;

        Ok(())
    }
}
