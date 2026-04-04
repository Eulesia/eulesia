#[cfg(test)]
mod tests {
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use uuid::Uuid;

    use crate::entities::push_subscriptions;
    use crate::repo::push_subscriptions::PushSubscriptionRepo;

    fn now() -> sea_orm::prelude::DateTimeWithTimeZone {
        chrono::Utc::now().fixed_offset()
    }

    fn make_push_sub(id: Uuid, user_id: Uuid) -> push_subscriptions::Model {
        push_subscriptions::Model {
            id,
            user_id,
            endpoint: format!("https://push.example.com/{id}"),
            p256dh: "test-p256dh-key".to_string(),
            auth: "test-auth-key".to_string(),
            user_agent: Some("TestAgent/1.0".to_string()),
            created_at: now(),
        }
    }

    // ── list_for_user ──

    #[tokio::test]
    async fn list_for_user_returns_subs() {
        let user_id = Uuid::now_v7();
        let s1 = make_push_sub(Uuid::now_v7(), user_id);
        let s2 = make_push_sub(Uuid::now_v7(), user_id);

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![s1.clone(), s2.clone()]])
            .into_connection();

        let result = PushSubscriptionRepo::list_for_user(&db, user_id)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
    }

    #[tokio::test]
    async fn list_for_user_empty() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<push_subscriptions::Model>::new()])
            .into_connection();

        let result = PushSubscriptionRepo::list_for_user(&db, Uuid::now_v7())
            .await
            .unwrap();
        assert!(result.is_empty());
    }

    // ── delete_by_endpoint ──

    #[tokio::test]
    async fn delete_by_endpoint_succeeds() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let result = PushSubscriptionRepo::delete_by_endpoint(
            &db,
            Uuid::now_v7(),
            "https://push.example.com/test",
        )
        .await;
        assert!(result.is_ok());
    }
}
