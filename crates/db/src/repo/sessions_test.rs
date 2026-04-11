#[cfg(test)]
mod tests {
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use uuid::Uuid;

    use crate::entities::sessions;
    use crate::repo::sessions::SessionRepo;

    fn now() -> sea_orm::prelude::DateTimeWithTimeZone {
        chrono::Utc::now().fixed_offset()
    }

    fn make_session(id: Uuid, user_id: Uuid, token_hash: &str) -> sessions::Model {
        sessions::Model {
            id,
            user_id,
            device_id: None,
            token_hash: token_hash.to_string(),
            ip_address: None,
            user_agent: None,
            expires_at: now() + chrono::Duration::days(30),
            last_used_at: None,
            revoked_at: None,
            created_at: now(),
        }
    }

    #[tokio::test]
    async fn find_by_token_hash_returns_session() {
        let session = make_session(Uuid::now_v7(), Uuid::now_v7(), "hash123");

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[session.clone()]])
            .into_connection();

        let result = SessionRepo::find_by_token_hash(&db, "hash123")
            .await
            .unwrap();
        assert_eq!(result.unwrap().token_hash, "hash123");
    }

    #[tokio::test]
    async fn find_by_token_hash_returns_none() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<sessions::Model>::new()])
            .into_connection();

        let result = SessionRepo::find_by_token_hash(&db, "nonexistent")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn find_by_id_returns_session() {
        let id = Uuid::now_v7();
        let session = make_session(id, Uuid::now_v7(), "tok");

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[session.clone()]])
            .into_connection();

        let result = SessionRepo::find_by_id(&db, id).await.unwrap();
        assert_eq!(result.unwrap().id, id);
    }

    #[tokio::test]
    async fn revoke_succeeds() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        SessionRepo::revoke(&db, Uuid::now_v7()).await.unwrap();
    }

    #[tokio::test]
    async fn bind_device_returns_true_when_session_is_updated() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let bound = SessionRepo::bind_device(&db, Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7())
            .await
            .unwrap();

        assert!(bound);
    }

    #[tokio::test]
    async fn bind_device_returns_false_when_session_is_not_updated() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 0,
            }])
            .into_connection();

        let bound = SessionRepo::bind_device(&db, Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7())
            .await
            .unwrap();

        assert!(!bound);
    }

    #[tokio::test]
    async fn revoke_unbound_sessions_for_user_returns_count() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 2,
            }])
            .into_connection();

        let revoked = SessionRepo::revoke_unbound_sessions_for_user(&db, Uuid::now_v7())
            .await
            .unwrap();

        assert_eq!(revoked, 2);
    }

    #[tokio::test]
    async fn cleanup_expired_returns_count() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 5,
            }])
            .into_connection();

        let result = SessionRepo::cleanup_expired(&db).await.unwrap();
        assert_eq!(result, 5);
    }
}
