use chrono::Utc;
use sea_orm::ColumnTrait;
use sea_orm::ConnectionTrait;
use sea_orm::DatabaseConnection;
use sea_orm::EntityTrait;
use sea_orm::prelude::Expr;
use sea_orm::{ActiveModelTrait, DbErr, QueryFilter};
use uuid::Uuid;

use crate::entities::device_pairing_tokens;

pub struct DevicePairingTokenRepo;

impl DevicePairingTokenRepo {
    pub async fn create(
        db: &DatabaseConnection,
        model: device_pairing_tokens::ActiveModel,
    ) -> Result<device_pairing_tokens::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn find_valid_by_hash(
        db: &DatabaseConnection,
        user_id: Uuid,
        code_hash: &str,
    ) -> Result<Option<device_pairing_tokens::Model>, DbErr> {
        device_pairing_tokens::Entity::find()
            .filter(device_pairing_tokens::Column::UserId.eq(user_id))
            .filter(device_pairing_tokens::Column::CodeHash.eq(code_hash))
            .filter(device_pairing_tokens::Column::UsedAt.is_null())
            .filter(device_pairing_tokens::Column::ExpiresAt.gt(Utc::now().fixed_offset()))
            .one(db)
            .await
    }

    pub async fn consume(
        db: &impl ConnectionTrait,
        user_id: Uuid,
        token_id: Uuid,
        used_by_device_id: Uuid,
    ) -> Result<bool, DbErr> {
        let result = device_pairing_tokens::Entity::update_many()
            .filter(device_pairing_tokens::Column::Id.eq(token_id))
            .filter(device_pairing_tokens::Column::UserId.eq(user_id))
            .filter(device_pairing_tokens::Column::UsedAt.is_null())
            .filter(device_pairing_tokens::Column::ExpiresAt.gt(Utc::now().fixed_offset()))
            .col_expr(
                device_pairing_tokens::Column::UsedAt,
                Expr::current_timestamp().into(),
            )
            .col_expr(
                device_pairing_tokens::Column::UsedByDeviceId,
                Expr::value(used_by_device_id),
            )
            .exec(db)
            .await?;

        Ok(result.rows_affected > 0)
    }
}
