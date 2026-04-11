use sea_orm_migration::prelude::*;

/// Clear messaging/state tables for an explicit E2EE reset.
///
/// This migration is opt-in and only runs when
/// `EULESIA_ALLOW_NUKE_MESSAGES` is enabled (`1`, `true`, `yes`).
/// It is retained for test or emergency recovery environments only.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if std::env::var("EULESIA_ALLOW_NUKE_MESSAGES")
            .map(|value| matches!(value.to_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false)
        {
            let db = manager.get_connection();

            // Single TRUNCATE ... CASCADE covers all listed tables and any
            // dependent rows reachable via foreign-key cascades.
            db.execute_unprepared(
                r"
            TRUNCATE
                messages,
                message_device_queue,
                message_redactions,
                memberships,
                membership_events,
                conversations,
                direct_conversations,
                conversation_epochs,
                devices,
                device_signed_pre_keys,
                one_time_pre_keys
            CASCADE
            ",
            )
            .await?;

            // Reset SERIAL / BIGSERIAL sequences that back any of these tables
            // (identity columns auto-reset on TRUNCATE … RESTART IDENTITY, but
            // these tables use UUID PKs so this is a no-op safety net).
            db.execute_unprepared(
                r"
            DO $$
            DECLARE
                seq RECORD;
            BEGIN
                FOR seq IN
                    SELECT s.relname AS seq_name
                    FROM pg_class s
                    JOIN pg_depend d  ON d.objid = s.oid
                    JOIN pg_class t   ON t.oid = d.refobjid
                    WHERE s.relkind = 'S'
                      AND t.relname IN (
                          'messages',
                          'message_device_queue',
                          'message_redactions',
                          'memberships',
                          'membership_events',
                          'conversations',
                          'direct_conversations',
                          'conversation_epochs',
                          'devices',
                          'device_signed_pre_keys',
                          'one_time_pre_keys'
                      )
                LOOP
                    EXECUTE format('ALTER SEQUENCE %I RESTART WITH 1', seq.seq_name);
                END LOOP;
            END
            $$
            ",
            )
            .await?;
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Data deletion is irreversible — down is a no-op.
        Ok(())
    }
}
