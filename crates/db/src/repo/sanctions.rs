use sea_orm::*;
use uuid::Uuid;

use crate::entities::user_sanctions;

pub struct SanctionRepo;

impl SanctionRepo {
    pub async fn create(
        db: &DatabaseConnection,
        model: user_sanctions::ActiveModel,
    ) -> Result<user_sanctions::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<user_sanctions::Model>, DbErr> {
        user_sanctions::Entity::find_by_id(id).one(db).await
    }

    pub async fn list(
        db: &DatabaseConnection,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<user_sanctions::Model>, u64), DbErr> {
        let query = user_sanctions::Entity::find();

        let total = query.clone().count(db).await?;

        let items = query
            .order_by_desc(user_sanctions::Column::IssuedAt)
            .offset(offset)
            .limit(limit)
            .all(db)
            .await?;

        Ok((items, total))
    }

    /// Return active (non-revoked, non-expired) sanctions for a user.
    pub async fn active_for_user(
        db: &DatabaseConnection,
        user_id: Uuid,
    ) -> Result<Vec<user_sanctions::Model>, DbErr> {
        let now = chrono::Utc::now().fixed_offset();

        user_sanctions::Entity::find()
            .filter(user_sanctions::Column::UserId.eq(user_id))
            .filter(user_sanctions::Column::RevokedAt.is_null())
            .filter(
                Condition::any()
                    .add(user_sanctions::Column::ExpiresAt.is_null())
                    .add(user_sanctions::Column::ExpiresAt.gt(now)),
            )
            .order_by_desc(user_sanctions::Column::IssuedAt)
            .all(db)
            .await
    }

    pub async fn revoke(db: &DatabaseConnection, id: Uuid, revoked_by: Uuid) -> Result<(), DbErr> {
        let now = chrono::Utc::now().fixed_offset();

        let am = user_sanctions::ActiveModel {
            id: ActiveValue::Set(id),
            revoked_at: ActiveValue::Set(Some(now)),
            revoked_by: ActiveValue::Set(Some(revoked_by)),
            ..Default::default()
        };

        am.update(db).await?;
        Ok(())
    }
}
