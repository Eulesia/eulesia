use sea_orm_migration::prelude::*;

/// Remove the superseded bespoke device pre-key state now that Matrix keys own
/// the E2EE handshake layer.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            "
            ALTER TABLE devices DROP CONSTRAINT IF EXISTS chk_devices_identity_key;
            ALTER TABLE devices ALTER COLUMN identity_key DROP NOT NULL;
            ALTER TABLE devices
                ADD CONSTRAINT chk_devices_identity_key
                CHECK (identity_key IS NULL OR octet_length(identity_key) > 0);
            DROP TABLE IF EXISTS device_signed_pre_keys;
            ",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            "
            CREATE TABLE IF NOT EXISTS device_signed_pre_keys (
                id uuid PRIMARY KEY,
                device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                key_id bigint NOT NULL,
                key_data bytea NOT NULL,
                signature bytea NOT NULL,
                created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
                superseded_at timestamptz NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_spk_device_key
                ON device_signed_pre_keys (device_id, key_id);
            CREATE INDEX IF NOT EXISTS idx_spk_device_current
                ON device_signed_pre_keys (device_id, created_at DESC)
                WHERE superseded_at IS NULL;
            ALTER TABLE device_signed_pre_keys
                DROP CONSTRAINT IF EXISTS chk_spk_key_data;
            ALTER TABLE device_signed_pre_keys
                DROP CONSTRAINT IF EXISTS chk_spk_signature;
            ALTER TABLE device_signed_pre_keys
                ADD CONSTRAINT chk_spk_key_data CHECK (octet_length(key_data) > 0);
            ALTER TABLE device_signed_pre_keys
                ADD CONSTRAINT chk_spk_signature CHECK (octet_length(signature) > 0);
            ALTER TABLE devices DROP CONSTRAINT IF EXISTS chk_devices_identity_key;
            UPDATE devices SET identity_key = decode('00', 'hex') WHERE identity_key IS NULL;
            ALTER TABLE devices ALTER COLUMN identity_key SET NOT NULL;
            ALTER TABLE devices
                ADD CONSTRAINT chk_devices_identity_key
                CHECK (octet_length(identity_key) > 0);
            ",
        )
        .await?;

        Ok(())
    }
}
