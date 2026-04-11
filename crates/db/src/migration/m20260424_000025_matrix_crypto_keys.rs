use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            "ALTER TABLE devices
                ADD COLUMN IF NOT EXISTS matrix_curve25519_key BYTEA NULL,
                ADD COLUMN IF NOT EXISTS matrix_ed25519_key BYTEA NULL,
                ADD COLUMN IF NOT EXISTS matrix_device_signature BYTEA NULL",
        )
        .await?;

        db.execute_unprepared(
            "ALTER TABLE one_time_pre_keys
                ADD COLUMN IF NOT EXISTS key_signature BYTEA NULL,
                ADD COLUMN IF NOT EXISTS key_algorithm VARCHAR(64) NULL,
                ADD COLUMN IF NOT EXISTS matrix_key_id VARCHAR(255) NULL,
                ADD COLUMN IF NOT EXISTS is_fallback BOOLEAN NOT NULL DEFAULT false",
        )
        .await?;

        db.execute_unprepared(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_time_pre_keys_matrix_key
                ON one_time_pre_keys (device_id, matrix_key_id)
                WHERE matrix_key_id IS NOT NULL",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared("DROP INDEX IF EXISTS idx_one_time_pre_keys_matrix_key")
            .await?;

        db.execute_unprepared(
            "ALTER TABLE one_time_pre_keys
                DROP COLUMN IF EXISTS is_fallback,
                DROP COLUMN IF EXISTS matrix_key_id,
                DROP COLUMN IF EXISTS key_algorithm,
                DROP COLUMN IF EXISTS key_signature",
        )
        .await?;

        db.execute_unprepared(
            "ALTER TABLE devices
                DROP COLUMN IF EXISTS matrix_device_signature,
                DROP COLUMN IF EXISTS matrix_ed25519_key,
                DROP COLUMN IF EXISTS matrix_curve25519_key",
        )
        .await?;

        Ok(())
    }
}
