use sea_orm::*;
use uuid::Uuid;

use crate::entities::push_subscriptions;

pub struct PushSubscriptionRepo;

impl PushSubscriptionRepo {
    pub async fn create(
        db: &DatabaseConnection,
        model: push_subscriptions::ActiveModel,
    ) -> Result<push_subscriptions::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn delete_by_endpoint(
        db: &DatabaseConnection,
        user_id: Uuid,
        endpoint: &str,
    ) -> Result<(), DbErr> {
        push_subscriptions::Entity::delete_many()
            .filter(push_subscriptions::Column::UserId.eq(user_id))
            .filter(push_subscriptions::Column::Endpoint.eq(endpoint))
            .exec(db)
            .await?;
        Ok(())
    }

    /// Delete a push subscription by endpoint regardless of user.
    /// Handles account switches on the same browser.
    pub async fn delete_by_endpoint_global(
        db: &DatabaseConnection,
        endpoint: &str,
    ) -> Result<(), DbErr> {
        push_subscriptions::Entity::delete_many()
            .filter(push_subscriptions::Column::Endpoint.eq(endpoint))
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn list_for_user(
        db: &impl ConnectionTrait,
        user_id: Uuid,
    ) -> Result<Vec<push_subscriptions::Model>, DbErr> {
        push_subscriptions::Entity::find()
            .filter(push_subscriptions::Column::UserId.eq(user_id))
            .all(db)
            .await
    }
}
