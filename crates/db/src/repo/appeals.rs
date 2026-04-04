use sea_orm::*;
use uuid::Uuid;

use crate::entities::moderation_appeals;

pub struct AppealRepo;

impl AppealRepo {
    pub async fn create(
        db: &DatabaseConnection,
        model: moderation_appeals::ActiveModel,
    ) -> Result<moderation_appeals::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<moderation_appeals::Model>, DbErr> {
        moderation_appeals::Entity::find_by_id(id).one(db).await
    }

    pub async fn list(
        db: &DatabaseConnection,
        status: Option<&str>,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<moderation_appeals::Model>, u64), DbErr> {
        let mut query = moderation_appeals::Entity::find();

        if let Some(s) = status {
            query = query.filter(moderation_appeals::Column::Status.eq(s));
        }

        let total = query.clone().count(db).await?;

        let items = query
            .order_by_desc(moderation_appeals::Column::CreatedAt)
            .offset(offset)
            .limit(limit)
            .all(db)
            .await?;

        Ok((items, total))
    }

    pub async fn respond(
        db: &DatabaseConnection,
        id: Uuid,
        admin_response: &str,
        responded_by: Uuid,
        status: &str,
    ) -> Result<(), DbErr> {
        let now = chrono::Utc::now().fixed_offset();

        let am = moderation_appeals::ActiveModel {
            id: ActiveValue::Set(id),
            admin_response: ActiveValue::Set(Some(admin_response.to_owned())),
            responded_by: ActiveValue::Set(Some(responded_by)),
            responded_at: ActiveValue::Set(Some(now)),
            status: ActiveValue::Set(status.to_owned()),
            ..Default::default()
        };

        am.update(db).await?;
        Ok(())
    }
}
