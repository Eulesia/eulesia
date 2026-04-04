#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, Value};
    use uuid::Uuid;

    use crate::entities::moderation_appeals;
    use crate::repo::appeals::AppealRepo;

    fn now() -> sea_orm::prelude::DateTimeWithTimeZone {
        chrono::Utc::now().fixed_offset()
    }

    fn make_appeal(id: Uuid, user_id: Uuid) -> moderation_appeals::Model {
        moderation_appeals::Model {
            id,
            user_id,
            sanction_id: None,
            report_id: None,
            action_id: None,
            reason: "unfair".to_string(),
            status: "pending".to_string(),
            admin_response: None,
            responded_by: None,
            responded_at: None,
            created_at: now(),
        }
    }

    fn count_result(n: i64) -> BTreeMap<String, Value> {
        BTreeMap::from([("num_items".to_string(), Value::BigInt(Some(n)))])
    }

    // ── find_by_id ──

    #[tokio::test]
    async fn find_by_id_returns_appeal() {
        let id = Uuid::now_v7();
        let appeal = make_appeal(id, Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[appeal.clone()]])
            .into_connection();

        let result = AppealRepo::find_by_id(&db, id).await.unwrap();
        assert_eq!(result.unwrap().id, id);
    }

    // ── list ──

    #[tokio::test]
    async fn list_returns_appeals() {
        let a1 = make_appeal(Uuid::now_v7(), Uuid::now_v7());
        let a2 = make_appeal(Uuid::now_v7(), Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(2)]])
            .append_query_results([vec![a1.clone(), a2.clone()]])
            .into_connection();

        let (items, total) = AppealRepo::list(&db, None, 0, 20).await.unwrap();

        assert_eq!(items.len(), 2);
        assert_eq!(total, 2);
    }

    #[tokio::test]
    async fn list_filtered_by_status() {
        let a1 = make_appeal(Uuid::now_v7(), Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(1)]])
            .append_query_results([vec![a1.clone()]])
            .into_connection();

        let (items, total) = AppealRepo::list(&db, Some("pending"), 0, 20).await.unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(total, 1);
    }

    // ── respond ──

    #[tokio::test]
    async fn respond_succeeds() {
        let appeal = make_appeal(Uuid::now_v7(), Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[appeal.clone()]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let result =
            AppealRepo::respond(&db, appeal.id, "Appeal denied", Uuid::now_v7(), "denied").await;
        assert!(result.is_ok());
    }
}
