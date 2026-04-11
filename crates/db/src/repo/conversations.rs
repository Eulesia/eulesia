use sea_orm::*;
use uuid::Uuid;

use crate::entities::{
    conversations, direct_conversations, membership_events, memberships, message_device_queue,
    messages,
};

pub struct ConversationRepo;

impl ConversationRepo {
    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<conversations::Model>, DbErr> {
        conversations::Entity::find_by_id(id)
            .filter(conversations::Column::DeletedAt.is_null())
            .one(db)
            .await
    }

    pub async fn find_direct(
        db: &DatabaseConnection,
        user_a: Uuid,
        user_b: Uuid,
    ) -> Result<Option<conversations::Model>, DbErr> {
        let (a, b) = if user_a < user_b {
            (user_a, user_b)
        } else {
            (user_b, user_a)
        };

        let direct = direct_conversations::Entity::find()
            .filter(direct_conversations::Column::UserAId.eq(a))
            .filter(direct_conversations::Column::UserBId.eq(b))
            .one(db)
            .await?;

        match direct {
            Some(d) => {
                conversations::Entity::find_by_id(d.conversation_id)
                    .one(db)
                    .await
            }
            None => Ok(None),
        }
    }

    pub async fn find_by_ids(
        db: &DatabaseConnection,
        ids: &[Uuid],
    ) -> Result<Vec<conversations::Model>, DbErr> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        conversations::Entity::find()
            .filter(conversations::Column::Id.is_in(ids.to_vec()))
            .filter(conversations::Column::DeletedAt.is_null())
            .all(db)
            .await
    }

    pub async fn active_members(
        db: &DatabaseConnection,
        conversation_id: Uuid,
    ) -> Result<Vec<memberships::Model>, DbErr> {
        memberships::Entity::find()
            .filter(memberships::Column::ConversationId.eq(conversation_id))
            .filter(memberships::Column::LeftAt.is_null())
            .all(db)
            .await
    }

    pub async fn user_conversations(
        db: &DatabaseConnection,
        user_id: Uuid,
    ) -> Result<Vec<memberships::Model>, DbErr> {
        memberships::Entity::find()
            .filter(memberships::Column::UserId.eq(user_id))
            .filter(memberships::Column::LeftAt.is_null())
            .all(db)
            .await
    }

    pub async fn messages_page(
        db: &DatabaseConnection,
        conversation_id: Uuid,
        before: Option<Uuid>,
        limit: u64,
        message_type: Option<&str>,
    ) -> Result<Vec<messages::Model>, DbErr> {
        let mut query = messages::Entity::find()
            .filter(messages::Column::ConversationId.eq(conversation_id))
            .order_by_desc(messages::Column::Id);

        if let Some(message_type) = message_type {
            query = query.filter(messages::Column::MessageType.eq(message_type));
        }

        if let Some(cursor) = before {
            query = query.filter(messages::Column::Id.lt(cursor));
        }

        query.limit(limit).all(db).await
    }

    pub async fn pending_deliveries(
        db: &DatabaseConnection,
        device_id: Uuid,
        limit: u64,
    ) -> Result<Vec<message_device_queue::Model>, DbErr> {
        message_device_queue::Entity::find()
            .filter(message_device_queue::Column::DeviceId.eq(device_id))
            .filter(message_device_queue::Column::DeliveredAt.is_null())
            .filter(message_device_queue::Column::FailedAt.is_null())
            .order_by_asc(message_device_queue::Column::EnqueuedAt)
            .limit(limit)
            .all(db)
            .await
    }

    pub async fn membership_history(
        db: &DatabaseConnection,
        conversation_id: Uuid,
    ) -> Result<Vec<membership_events::Model>, DbErr> {
        membership_events::Entity::find()
            .filter(membership_events::Column::ConversationId.eq(conversation_id))
            .order_by_asc(membership_events::Column::CreatedAt)
            .all(db)
            .await
    }
}
