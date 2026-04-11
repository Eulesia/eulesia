use sea_orm::prelude::Expr;
use sea_orm::*;
use uuid::Uuid;

use crate::entities::sessions;

pub struct SessionRepo;

impl SessionRepo {
    pub async fn create(
        db: &DatabaseConnection,
        model: sessions::ActiveModel,
    ) -> Result<sessions::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn find_by_token_hash(
        db: &DatabaseConnection,
        token_hash: &str,
    ) -> Result<Option<sessions::Model>, DbErr> {
        sessions::Entity::find()
            .filter(sessions::Column::TokenHash.eq(token_hash))
            .filter(sessions::Column::RevokedAt.is_null())
            .one(db)
            .await
    }

    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<sessions::Model>, DbErr> {
        sessions::Entity::find_by_id(id).one(db).await
    }

    pub async fn revoke(db: &DatabaseConnection, id: Uuid) -> Result<(), DbErr> {
        sessions::Entity::update_many()
            .filter(sessions::Column::Id.eq(id))
            .col_expr(
                sessions::Column::RevokedAt,
                Expr::current_timestamp().into(),
            )
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn revoke_all_for_user(db: &DatabaseConnection, user_id: Uuid) -> Result<u64, DbErr> {
        let result = sessions::Entity::update_many()
            .filter(sessions::Column::UserId.eq(user_id))
            .filter(sessions::Column::RevokedAt.is_null())
            .col_expr(
                sessions::Column::RevokedAt,
                Expr::current_timestamp().into(),
            )
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    pub async fn revoke_all_except(
        db: &DatabaseConnection,
        user_id: Uuid,
        keep_session_id: Uuid,
    ) -> Result<u64, DbErr> {
        let result = sessions::Entity::update_many()
            .filter(sessions::Column::UserId.eq(user_id))
            .filter(sessions::Column::Id.ne(keep_session_id))
            .filter(sessions::Column::RevokedAt.is_null())
            .col_expr(
                sessions::Column::RevokedAt,
                Expr::current_timestamp().into(),
            )
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    pub async fn bind_device(
        db: &impl ConnectionTrait,
        session_id: Uuid,
        user_id: Uuid,
        device_id: Uuid,
    ) -> Result<bool, DbErr> {
        let result = sessions::Entity::update_many()
            .filter(sessions::Column::Id.eq(session_id))
            .filter(sessions::Column::UserId.eq(user_id))
            .filter(sessions::Column::RevokedAt.is_null())
            .filter(sessions::Column::DeviceId.is_null())
            .col_expr(sessions::Column::DeviceId, Expr::value(device_id))
            .exec(db)
            .await?;

        Ok(result.rows_affected > 0)
    }

    pub async fn revoke_device_sessions(
        db: &DatabaseConnection,
        device_id: Uuid,
    ) -> Result<u64, DbErr> {
        let result = sessions::Entity::update_many()
            .filter(sessions::Column::DeviceId.eq(device_id))
            .filter(sessions::Column::RevokedAt.is_null())
            .col_expr(
                sessions::Column::RevokedAt,
                Expr::current_timestamp().into(),
            )
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    pub async fn revoke_unbound_sessions_for_user(
        db: &DatabaseConnection,
        user_id: Uuid,
    ) -> Result<u64, DbErr> {
        let result = sessions::Entity::update_many()
            .filter(sessions::Column::UserId.eq(user_id))
            .filter(sessions::Column::DeviceId.is_null())
            .filter(sessions::Column::RevokedAt.is_null())
            .col_expr(
                sessions::Column::RevokedAt,
                Expr::current_timestamp().into(),
            )
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    pub async fn cleanup_expired(db: &DatabaseConnection) -> Result<u64, DbErr> {
        let result = sessions::Entity::delete_many()
            .filter(
                Condition::any()
                    .add(sessions::Column::ExpiresAt.lt(chrono::Utc::now().fixed_offset()))
                    .add(sessions::Column::RevokedAt.is_not_null()),
            )
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    pub async fn update_last_used(db: &DatabaseConnection, id: Uuid) -> Result<(), DbErr> {
        sessions::Entity::update_many()
            .filter(sessions::Column::Id.eq(id))
            .col_expr(
                sessions::Column::LastUsedAt,
                Expr::current_timestamp().into(),
            )
            .exec(db)
            .await?;
        Ok(())
    }
}
