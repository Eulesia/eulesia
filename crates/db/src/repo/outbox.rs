use sea_orm::prelude::{DateTimeWithTimeZone, Expr};
use sea_orm::*;
use uuid::Uuid;

use crate::entities::outbox;

pub struct OutboxRepo;

impl OutboxRepo {
    pub async fn create(
        db: &impl ConnectionTrait,
        model: outbox::ActiveModel,
    ) -> Result<outbox::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn fetch_pending(
        db: &DatabaseConnection,
        limit: u64,
    ) -> Result<Vec<outbox::Model>, DbErr> {
        let now = chrono::Utc::now().fixed_offset();
        outbox::Entity::find()
            .filter(
                Condition::any()
                    .add(outbox::Column::Status.eq("pending"))
                    .add(outbox::Column::Status.eq("failed")),
            )
            .filter(outbox::Column::AvailableAt.lte(now))
            .order_by_asc(outbox::Column::AvailableAt)
            .limit(limit)
            .all(db)
            .await
    }

    pub async fn mark_completed(db: &DatabaseConnection, id: Uuid) -> Result<(), DbErr> {
        outbox::Entity::update_many()
            .filter(outbox::Column::Id.eq(id))
            .col_expr(outbox::Column::Status, Expr::value("completed"))
            .col_expr(
                outbox::Column::ProcessedAt,
                Expr::current_timestamp().into(),
            )
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn mark_failed(
        db: &DatabaseConnection,
        id: Uuid,
        error: &str,
        next_available_at: DateTimeWithTimeZone,
    ) -> Result<(), DbErr> {
        outbox::Entity::update_many()
            .filter(outbox::Column::Id.eq(id))
            .col_expr(outbox::Column::Status, Expr::value("failed"))
            .col_expr(outbox::Column::LastError, Expr::value(error))
            .col_expr(
                outbox::Column::AttemptCount,
                Expr::col(outbox::Column::AttemptCount).add(1),
            )
            .col_expr(outbox::Column::AvailableAt, Expr::value(next_available_at))
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn mark_dead(db: &DatabaseConnection, id: Uuid, error: &str) -> Result<(), DbErr> {
        outbox::Entity::update_many()
            .filter(outbox::Column::Id.eq(id))
            .col_expr(outbox::Column::Status, Expr::value("dead"))
            .col_expr(outbox::Column::LastError, Expr::value(error))
            .col_expr(
                outbox::Column::ProcessedAt,
                Expr::current_timestamp().into(),
            )
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn cleanup_completed(
        db: &DatabaseConnection,
        older_than: DateTimeWithTimeZone,
    ) -> Result<u64, DbErr> {
        let result = outbox::Entity::delete_many()
            .filter(outbox::Column::Status.eq("completed"))
            .filter(outbox::Column::ProcessedAt.lt(older_than))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }
}
