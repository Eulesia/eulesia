#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, Value};
    use uuid::Uuid;

    use crate::entities::notifications;
    use crate::repo::notifications::NotificationRepo;

    fn now() -> sea_orm::prelude::DateTimeWithTimeZone {
        chrono::Utc::now().fixed_offset()
    }

    fn make_notification(id: Uuid, user_id: Uuid) -> notifications::Model {
        notifications::Model {
            id,
            user_id,
            event_type: "reply".to_string(),
            title: "New reply".to_string(),
            body: Some("Someone replied to your thread".to_string()),
            link: Some("/threads/123".to_string()),
            read: false,
            created_at: now(),
        }
    }

    fn count_result(n: i64) -> BTreeMap<String, Value> {
        BTreeMap::from([("num_items".to_string(), Value::BigInt(Some(n)))])
    }

    // ── list_for_user ──

    #[tokio::test]
    async fn list_for_user_returns_notifications() {
        let user_id = Uuid::now_v7();
        let n1 = make_notification(Uuid::now_v7(), user_id);
        let n2 = make_notification(Uuid::now_v7(), user_id);

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(2)]])
            .append_query_results([vec![n1.clone(), n2.clone()]])
            .into_connection();

        let (items, total) = NotificationRepo::list_for_user(&db, user_id, 0, 20)
            .await
            .unwrap();

        assert_eq!(items.len(), 2);
        assert_eq!(total, 2);
    }

    #[tokio::test]
    async fn list_for_user_empty() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<notifications::Model>::new()])
            .into_connection();

        let (items, total) = NotificationRepo::list_for_user(&db, Uuid::now_v7(), 0, 20)
            .await
            .unwrap();

        assert!(items.is_empty());
        assert_eq!(total, 0);
    }

    // ── unread_count ──

    #[tokio::test]
    async fn unread_count_returns_count() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(5)]])
            .into_connection();

        let result = NotificationRepo::unread_count(&db, Uuid::now_v7())
            .await
            .unwrap();
        assert_eq!(result, 5);
    }

    // ── mark_read ──

    #[tokio::test]
    async fn mark_read_succeeds() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let result = NotificationRepo::mark_read(&db, Uuid::now_v7(), Uuid::now_v7()).await;
        assert!(result.is_ok());
    }

    // ── mark_all_read ──

    #[tokio::test]
    async fn mark_all_read_returns_count() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 3,
            }])
            .into_connection();

        let result = NotificationRepo::mark_all_read(&db, Uuid::now_v7())
            .await
            .unwrap();
        assert_eq!(result, 3);
    }
}
