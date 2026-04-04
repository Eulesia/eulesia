use sea_orm::*;
use uuid::Uuid;

use crate::entities::moderation_actions;

pub struct ModerationActionRepo;

impl ModerationActionRepo {
    pub async fn create(
        db: &DatabaseConnection,
        model: moderation_actions::ActiveModel,
    ) -> Result<moderation_actions::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn list_for_report(
        db: &DatabaseConnection,
        report_id: Uuid,
    ) -> Result<Vec<moderation_actions::Model>, DbErr> {
        moderation_actions::Entity::find()
            .filter(moderation_actions::Column::ReportId.eq(report_id))
            .order_by_desc(moderation_actions::Column::CreatedAt)
            .all(db)
            .await
    }
}
