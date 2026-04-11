#[cfg(test)]
mod tests {
    use sea_orm::{DatabaseBackend, MockDatabase};
    use uuid::Uuid;

    use crate::entities::{
        conversations, direct_conversations, membership_events, memberships, message_device_queue,
        messages,
    };
    use crate::repo::conversations::ConversationRepo;

    fn now() -> sea_orm::prelude::DateTimeWithTimeZone {
        chrono::Utc::now().fixed_offset()
    }

    fn make_conversation(id: Uuid, conv_type: &str) -> conversations::Model {
        conversations::Model {
            id,
            r#type: conv_type.to_string(),
            encryption: "e2ee".to_string(),
            name: None,
            description: None,
            avatar_url: None,
            creator_id: None,
            is_public: false,
            current_epoch: 0,
            deleted_at: None,
            created_at: now(),
            updated_at: now(),
        }
    }

    fn make_membership(id: Uuid, conversation_id: Uuid, user_id: Uuid) -> memberships::Model {
        memberships::Model {
            id,
            conversation_id,
            user_id,
            role: "member".to_string(),
            joined_epoch: 0,
            left_at: None,
            removed_by: None,
            created_at: now(),
            last_read_at: None,
        }
    }

    fn make_message(id: Uuid, conversation_id: Uuid, sender_id: Uuid) -> messages::Model {
        messages::Model {
            id,
            conversation_id,
            sender_id,
            sender_device_id: Some(Uuid::now_v7()),
            epoch: 0,
            ciphertext: Some(vec![0xde, 0xad, 0xbe, 0xef]),
            message_type: "text".to_string(),
            server_ts: now(),
        }
    }

    fn make_queue_entry(message_id: Uuid, device_id: Uuid) -> message_device_queue::Model {
        message_device_queue::Model {
            message_id,
            device_id,
            ciphertext: vec![0xca, 0xfe],
            enqueued_at: now(),
            delivered_at: None,
            failed_at: None,
            attempt_count: 0,
        }
    }

    fn make_membership_event(id: Uuid, conversation_id: Uuid) -> membership_events::Model {
        membership_events::Model {
            id,
            conversation_id,
            user_id: Uuid::now_v7(),
            event_type: "joined".to_string(),
            epoch: 0,
            actor_id: None,
            metadata: None,
            created_at: now(),
        }
    }

    // ── find_by_id ──

    #[tokio::test]
    async fn find_by_id_returns_conversation() {
        let id = Uuid::now_v7();
        let conv = make_conversation(id, "group");

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[conv.clone()]])
            .into_connection();

        let result = ConversationRepo::find_by_id(&db, id).await.unwrap();
        assert_eq!(result.unwrap().r#type, "group");
    }

    #[tokio::test]
    async fn find_by_id_returns_none_when_missing() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<conversations::Model>::new()])
            .into_connection();

        let result = ConversationRepo::find_by_id(&db, Uuid::now_v7())
            .await
            .unwrap();
        assert!(result.is_none());
    }

    // ── find_direct ──

    #[tokio::test]
    async fn find_direct_returns_conversation_for_pair() {
        let conv_id = Uuid::now_v7();
        let user_a = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let user_b = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();

        let direct = direct_conversations::Model {
            conversation_id: conv_id,
            user_a_id: user_a,
            user_b_id: user_b,
        };
        let conv = make_conversation(conv_id, "direct");

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[direct]])
            .append_query_results([[conv.clone()]])
            .into_connection();

        let result = ConversationRepo::find_direct(&db, user_a, user_b)
            .await
            .unwrap();
        assert_eq!(result.unwrap().id, conv_id);
    }

    #[tokio::test]
    async fn find_direct_normalises_user_order() {
        // user_b < user_a, so the function should swap them
        let conv_id = Uuid::now_v7();
        let user_a = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();
        let user_b = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();

        let direct = direct_conversations::Model {
            conversation_id: conv_id,
            user_a_id: user_b, // smaller
            user_b_id: user_a, // larger
        };
        let conv = make_conversation(conv_id, "direct");

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[direct]])
            .append_query_results([[conv.clone()]])
            .into_connection();

        // Pass in non-canonical order — repo should normalise
        let result = ConversationRepo::find_direct(&db, user_a, user_b)
            .await
            .unwrap();
        assert_eq!(result.unwrap().id, conv_id);
    }

    #[tokio::test]
    async fn find_direct_returns_none_when_no_conversation() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<direct_conversations::Model>::new()])
            .into_connection();

        let result = ConversationRepo::find_direct(&db, Uuid::now_v7(), Uuid::now_v7())
            .await
            .unwrap();
        assert!(result.is_none());
    }

    // ── active_members ──

    #[tokio::test]
    async fn active_members_returns_non_left() {
        let conv_id = Uuid::now_v7();
        let m1 = make_membership(Uuid::now_v7(), conv_id, Uuid::now_v7());
        let m2 = make_membership(Uuid::now_v7(), conv_id, Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![m1, m2]])
            .into_connection();

        let result = ConversationRepo::active_members(&db, conv_id)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|m| m.left_at.is_none()));
    }

    #[tokio::test]
    async fn active_members_empty_when_all_left() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<memberships::Model>::new()])
            .into_connection();

        let result = ConversationRepo::active_members(&db, Uuid::now_v7())
            .await
            .unwrap();
        assert!(result.is_empty());
    }

    // ── user_conversations ──

    #[tokio::test]
    async fn user_conversations_returns_active_memberships() {
        let user_id = Uuid::now_v7();
        let m1 = make_membership(Uuid::now_v7(), Uuid::now_v7(), user_id);
        let m2 = make_membership(Uuid::now_v7(), Uuid::now_v7(), user_id);

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![m1, m2]])
            .into_connection();

        let result = ConversationRepo::user_conversations(&db, user_id)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
    }

    // ── messages_page ──

    #[tokio::test]
    async fn messages_page_returns_messages_without_cursor() {
        let conv_id = Uuid::now_v7();
        let sender = Uuid::now_v7();
        let m1 = make_message(Uuid::now_v7(), conv_id, sender);
        let m2 = make_message(Uuid::now_v7(), conv_id, sender);

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![m1, m2]])
            .into_connection();

        let result = ConversationRepo::messages_page(&db, conv_id, None, 50, None)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
    }

    #[tokio::test]
    async fn messages_page_with_cursor_filters_older() {
        let conv_id = Uuid::now_v7();
        let sender = Uuid::now_v7();
        let older = make_message(Uuid::now_v7(), conv_id, sender);

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![older.clone()]])
            .into_connection();

        let cursor = Uuid::now_v7();
        let result = ConversationRepo::messages_page(&db, conv_id, Some(cursor), 50, None)
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
    }

    #[tokio::test]
    async fn messages_page_empty_conversation() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<messages::Model>::new()])
            .into_connection();

        let result = ConversationRepo::messages_page(&db, Uuid::now_v7(), None, 50, None)
            .await
            .unwrap();
        assert!(result.is_empty());
    }

    // ── pending_deliveries ──

    #[tokio::test]
    async fn pending_deliveries_returns_undelivered() {
        let device_id = Uuid::now_v7();
        let q1 = make_queue_entry(Uuid::now_v7(), device_id);
        let q2 = make_queue_entry(Uuid::now_v7(), device_id);

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![q1, q2]])
            .into_connection();

        let result = ConversationRepo::pending_deliveries(&db, device_id, 100)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|q| q.delivered_at.is_none()));
        assert!(result.iter().all(|q| q.failed_at.is_none()));
    }

    #[tokio::test]
    async fn pending_deliveries_empty_when_all_delivered() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<message_device_queue::Model>::new()])
            .into_connection();

        let result = ConversationRepo::pending_deliveries(&db, Uuid::now_v7(), 100)
            .await
            .unwrap();
        assert!(result.is_empty());
    }

    // ── membership_history ──

    #[tokio::test]
    async fn membership_history_returns_events() {
        let conv_id = Uuid::now_v7();
        let e1 = make_membership_event(Uuid::now_v7(), conv_id);
        let e2 = make_membership_event(Uuid::now_v7(), conv_id);

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![e1, e2]])
            .into_connection();

        let result = ConversationRepo::membership_history(&db, conv_id)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
    }

    #[tokio::test]
    async fn membership_history_empty_for_new_conversation() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<membership_events::Model>::new()])
            .into_connection();

        let result = ConversationRepo::membership_history(&db, Uuid::now_v7())
            .await
            .unwrap();
        assert!(result.is_empty());
    }
}
