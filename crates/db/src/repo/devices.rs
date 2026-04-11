use sea_orm::prelude::Expr;
use sea_orm::*;
use uuid::Uuid;

use crate::entities::devices;

pub struct DeviceRepo;

impl DeviceRepo {
    fn enrolled_filter() -> Condition {
        Condition::all()
            .add(devices::Column::MatrixCurve25519Key.is_not_null())
            .add(devices::Column::MatrixEd25519Key.is_not_null())
            .add(devices::Column::MatrixDeviceSignature.is_not_null())
    }

    pub async fn create(
        db: &impl ConnectionTrait,
        model: devices::ActiveModel,
    ) -> Result<devices::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<devices::Model>, DbErr> {
        devices::Entity::find_by_id(id).one(db).await
    }

    pub async fn find_by_id_and_user(
        db: &DatabaseConnection,
        id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<devices::Model>, DbErr> {
        devices::Entity::find()
            .filter(devices::Column::Id.eq(id))
            .filter(devices::Column::UserId.eq(user_id))
            .one(db)
            .await
    }

    pub async fn list_active_for_user(
        db: &impl ConnectionTrait,
        user_id: Uuid,
    ) -> Result<Vec<devices::Model>, DbErr> {
        devices::Entity::find()
            .filter(devices::Column::UserId.eq(user_id))
            .filter(devices::Column::RevokedAt.is_null())
            .order_by_desc(devices::Column::CreatedAt)
            .all(db)
            .await
    }

    pub async fn list_enrolled_for_user(
        db: &impl ConnectionTrait,
        user_id: Uuid,
    ) -> Result<Vec<devices::Model>, DbErr> {
        devices::Entity::find()
            .filter(devices::Column::UserId.eq(user_id))
            .filter(devices::Column::RevokedAt.is_null())
            .filter(Self::enrolled_filter())
            .order_by_desc(devices::Column::CreatedAt)
            .all(db)
            .await
    }

    pub async fn list_active_for_users(
        db: &impl ConnectionTrait,
        user_ids: &[Uuid],
    ) -> Result<Vec<devices::Model>, DbErr> {
        if user_ids.is_empty() {
            return Ok(vec![]);
        }
        devices::Entity::find()
            .filter(devices::Column::UserId.is_in(user_ids.to_vec()))
            .filter(devices::Column::RevokedAt.is_null())
            .all(db)
            .await
    }

    pub async fn list_enrolled_for_users(
        db: &impl ConnectionTrait,
        user_ids: &[Uuid],
    ) -> Result<Vec<devices::Model>, DbErr> {
        if user_ids.is_empty() {
            return Ok(vec![]);
        }
        devices::Entity::find()
            .filter(devices::Column::UserId.is_in(user_ids.to_vec()))
            .filter(devices::Column::RevokedAt.is_null())
            .filter(Self::enrolled_filter())
            .all(db)
            .await
    }

    pub async fn revoke(db: &DatabaseConnection, id: Uuid) -> Result<(), DbErr> {
        devices::Entity::update_many()
            .filter(devices::Column::Id.eq(id))
            .col_expr(devices::Column::RevokedAt, Expr::current_timestamp().into())
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn has_enrolled_device(
        db: &impl ConnectionTrait,
        user_id: Uuid,
    ) -> Result<bool, DbErr> {
        let count = devices::Entity::find()
            .filter(devices::Column::UserId.eq(user_id))
            .filter(devices::Column::RevokedAt.is_null())
            .filter(Self::enrolled_filter())
            .count(db)
            .await?;
        Ok(count > 0)
    }

    pub async fn count_active_for_user(
        db: &DatabaseConnection,
        user_id: Uuid,
    ) -> Result<u64, DbErr> {
        devices::Entity::find()
            .filter(devices::Column::UserId.eq(user_id))
            .filter(devices::Column::RevokedAt.is_null())
            .count(db)
            .await
    }

    pub async fn count_enrolled_for_user(
        db: &DatabaseConnection,
        user_id: Uuid,
    ) -> Result<u64, DbErr> {
        devices::Entity::find()
            .filter(devices::Column::UserId.eq(user_id))
            .filter(devices::Column::RevokedAt.is_null())
            .filter(Self::enrolled_filter())
            .count(db)
            .await
    }
}
