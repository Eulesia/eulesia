use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                r"
                -- TOTP fields on admin_accounts
                ALTER TABLE admin_accounts
                    ADD COLUMN IF NOT EXISTS totp_secret TEXT,
                    ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

                -- WebAuthn passkey credentials
                CREATE TABLE IF NOT EXISTS admin_passkeys (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
                    credential_id BYTEA NOT NULL UNIQUE,
                    credential JSON NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_used_at TIMESTAMPTZ
                );
                CREATE INDEX IF NOT EXISTS admin_passkeys_admin_idx
                    ON admin_passkeys(admin_id);
                CREATE INDEX IF NOT EXISTS admin_passkeys_cred_idx
                    ON admin_passkeys(credential_id);

                -- Pending sessions (between password verification and 2FA)
                CREATE TABLE IF NOT EXISTS admin_pending_sessions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
                    token_hash VARCHAR(255) NOT NULL UNIQUE,
                    webauthn_state JSON,
                    totp_secret_temp TEXT,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS admin_pending_sessions_token_idx
                    ON admin_pending_sessions(token_hash);

                -- Recovery codes (one-time use)
                CREATE TABLE IF NOT EXISTS admin_recovery_codes (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
                    code_hash VARCHAR(255) NOT NULL,
                    used_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS admin_recovery_codes_admin_idx
                    ON admin_recovery_codes(admin_id);
                ",
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                r"
                DROP TABLE IF EXISTS admin_recovery_codes;
                DROP TABLE IF EXISTS admin_pending_sessions;
                DROP TABLE IF EXISTS admin_passkeys;
                ALTER TABLE admin_accounts
                    DROP COLUMN IF EXISTS totp_secret,
                    DROP COLUMN IF EXISTS totp_enabled;
                ",
            )
            .await?;

        Ok(())
    }
}
