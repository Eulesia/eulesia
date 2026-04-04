use sea_orm::*;
use uuid::Uuid;

use crate::entities::content_reports;

pub struct ReportRepo;

impl ReportRepo {
    pub async fn create(
        db: &DatabaseConnection,
        model: content_reports::ActiveModel,
    ) -> Result<content_reports::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<content_reports::Model>, DbErr> {
        content_reports::Entity::find_by_id(id).one(db).await
    }

    pub async fn list(
        db: &DatabaseConnection,
        status: Option<&str>,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<content_reports::Model>, u64), DbErr> {
        let mut query = content_reports::Entity::find();

        if let Some(s) = status {
            query = query.filter(content_reports::Column::Status.eq(s));
        }

        let total = query.clone().count(db).await?;

        let items = query
            .order_by_desc(content_reports::Column::CreatedAt)
            .offset(offset)
            .limit(limit)
            .all(db)
            .await?;

        Ok((items, total))
    }

    pub async fn update_status(
        db: &DatabaseConnection,
        id: Uuid,
        status: &str,
        resolved_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    ) -> Result<(), DbErr> {
        let mut am = content_reports::ActiveModel {
            id: ActiveValue::Set(id),
            status: ActiveValue::Set(status.to_owned()),
            ..Default::default()
        };

        if let Some(ts) = resolved_at {
            am.resolved_at = ActiveValue::Set(Some(ts));
        }

        am.update(db).await?;
        Ok(())
    }

    pub async fn assign(
        db: &DatabaseConnection,
        id: Uuid,
        moderator_id: Uuid,
    ) -> Result<(), DbErr> {
        let am = content_reports::ActiveModel {
            id: ActiveValue::Set(id),
            assigned_to: ActiveValue::Set(Some(moderator_id)),
            ..Default::default()
        };

        am.update(db).await?;
        Ok(())
    }
}
