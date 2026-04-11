use sea_orm_migration::prelude::*;

/// Add `skd` (sender key distribution) to the allowed message types.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r"
            ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_type;
            ALTER TABLE messages ADD CONSTRAINT chk_messages_type
                CHECK (message_type IN ('text', 'media', 'system', 'reaction', 'redaction', 'skd'));
            ",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r"
            DELETE FROM messages WHERE message_type = 'skd';
            ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_type;
            ALTER TABLE messages ADD CONSTRAINT chk_messages_type
                CHECK (message_type IN ('text', 'media', 'system', 'reaction', 'redaction'));
            ",
        )
        .await?;

        Ok(())
    }
}
