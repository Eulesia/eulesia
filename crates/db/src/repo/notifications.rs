use sea_orm::prelude::Expr;
use sea_orm::*;
use uuid::Uuid;

use crate::entities::notifications;

pub struct NotificationRepo;

impl NotificationRepo {
    pub async fn create(
        db: &DatabaseConnection,
        model: notifications::ActiveModel,
    ) -> Result<notifications::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn list_for_user(
        db: &DatabaseConnection,
        user_id: Uuid,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<notifications::Model>, u64), DbErr> {
        let query = notifications::Entity::find().filter(notifications::Column::UserId.eq(user_id));
        let total = query.clone().count(db).await?;
        let items = query
            .order_by_desc(notifications::Column::CreatedAt)
            .offset(offset)
            .limit(limit)
            .all(db)
            .await?;
        Ok((items, total))
    }

    pub async fn unread_count(db: &DatabaseConnection, user_id: Uuid) -> Result<u64, DbErr> {
        notifications::Entity::find()
            .filter(notifications::Column::UserId.eq(user_id))
            .filter(notifications::Column::Read.eq(false))
            .count(db)
            .await
    }

    pub async fn mark_read(db: &DatabaseConnection, id: Uuid, user_id: Uuid) -> Result<(), DbErr> {
        notifications::Entity::update_many()
            .filter(notifications::Column::Id.eq(id))
            .filter(notifications::Column::UserId.eq(user_id))
            .col_expr(notifications::Column::Read, Expr::value(true))
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn mark_all_read(db: &DatabaseConnection, user_id: Uuid) -> Result<u64, DbErr> {
        let result = notifications::Entity::update_many()
            .filter(notifications::Column::UserId.eq(user_id))
            .filter(notifications::Column::Read.eq(false))
            .col_expr(notifications::Column::Read, Expr::value(true))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    pub async fn delete(db: &DatabaseConnection, id: Uuid, user_id: Uuid) -> Result<(), DbErr> {
        notifications::Entity::delete_many()
            .filter(notifications::Column::Id.eq(id))
            .filter(notifications::Column::UserId.eq(user_id))
            .exec(db)
            .await?;
        Ok(())
    }
}
