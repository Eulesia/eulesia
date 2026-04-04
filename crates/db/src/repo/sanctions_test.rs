#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, Value};
    use uuid::Uuid;

    use crate::entities::user_sanctions;
    use crate::repo::sanctions::SanctionRepo;

    fn now() -> sea_orm::prelude::DateTimeWithTimeZone {
        chrono::Utc::now().fixed_offset()
    }

    fn make_sanction(id: Uuid, user_id: Uuid, issued_by: Uuid) -> user_sanctions::Model {
        user_sanctions::Model {
            id,
            user_id,
            sanction_type: "mute".to_string(),
            reason: Some("spamming".to_string()),
            issued_by,
            issued_at: now(),
            expires_at: None,
            revoked_at: None,
            revoked_by: None,
        }
    }

    fn count_result(n: i64) -> BTreeMap<String, Value> {
        BTreeMap::from([("num_items".to_string(), Value::BigInt(Some(n)))])
    }

    // ── find_by_id ──

    #[tokio::test]
    async fn find_by_id_returns_sanction() {
        let id = Uuid::now_v7();
        let sanction = make_sanction(id, Uuid::now_v7(), Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[sanction.clone()]])
            .into_connection();

        let result = SanctionRepo::find_by_id(&db, id).await.unwrap();
        assert_eq!(result.unwrap().id, id);
    }

    // ── list ──

    #[tokio::test]
    async fn list_returns_sanctions() {
        let s1 = make_sanction(Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
        let s2 = make_sanction(Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(2)]])
            .append_query_results([vec![s1.clone(), s2.clone()]])
            .into_connection();

        let (items, total) = SanctionRepo::list(&db, 0, 20).await.unwrap();

        assert_eq!(items.len(), 2);
        assert_eq!(total, 2);
    }

    // ── active_for_user ──

    #[tokio::test]
    async fn active_for_user_returns_active() {
        let user_id = Uuid::now_v7();
        let s1 = make_sanction(Uuid::now_v7(), user_id, Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![s1.clone()]])
            .into_connection();

        let result = SanctionRepo::active_for_user(&db, user_id).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].user_id, user_id);
    }

    // ── revoke ──

    #[tokio::test]
    async fn revoke_succeeds() {
        let sanction = make_sanction(Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[sanction.clone()]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let result = SanctionRepo::revoke(&db, sanction.id, Uuid::now_v7()).await;
        assert!(result.is_ok());
    }
}
