use sea_orm_migration::prelude::*;

/// Replace the bespoke `skd` protocol message type with the generic
/// Matrix-oriented `to_device` transport marker.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r"
            UPDATE messages SET message_type = 'to_device' WHERE message_type = 'skd';
            ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_type;
            ALTER TABLE messages ADD CONSTRAINT chk_messages_type
                CHECK (message_type IN ('text', 'media', 'system', 'reaction', 'redaction', 'to_device'));
            ",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // Delete rather than rewrite: post-migration `to_device` messages may
        // have been created natively (not originally `skd`), so a blanket
        // UPDATE would distort history. Remove them and restore the old
        // constraint.
        db.execute_unprepared(
            r"
            DELETE FROM messages WHERE message_type = 'to_device';
            ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_type;
            ALTER TABLE messages ADD CONSTRAINT chk_messages_type
                CHECK (message_type IN ('text', 'media', 'system', 'reaction', 'redaction', 'skd'));
            ",
        )
        .await?;

        Ok(())
    }
}
