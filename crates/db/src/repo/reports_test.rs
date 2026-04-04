#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, Value};
    use uuid::Uuid;

    use crate::entities::content_reports;
    use crate::repo::reports::ReportRepo;

    fn now() -> sea_orm::prelude::DateTimeWithTimeZone {
        chrono::Utc::now().fixed_offset()
    }

    fn make_report(id: Uuid, reporter_id: Uuid) -> content_reports::Model {
        content_reports::Model {
            id,
            reporter_id,
            content_type: "thread".to_string(),
            content_id: Uuid::now_v7(),
            reason: "spam".to_string(),
            description: None,
            evidence: None,
            status: "pending".to_string(),
            assigned_to: None,
            resolved_at: None,
            created_at: now(),
        }
    }

    fn count_result(n: i64) -> BTreeMap<String, Value> {
        BTreeMap::from([("num_items".to_string(), Value::BigInt(Some(n)))])
    }

    // ── find_by_id ──

    #[tokio::test]
    async fn find_by_id_returns_report() {
        let id = Uuid::now_v7();
        let report = make_report(id, Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[report.clone()]])
            .into_connection();

        let result = ReportRepo::find_by_id(&db, id).await.unwrap();
        assert_eq!(result.unwrap().id, id);
    }

    #[tokio::test]
    async fn find_by_id_returns_none() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<content_reports::Model>::new()])
            .into_connection();

        let result = ReportRepo::find_by_id(&db, Uuid::now_v7()).await.unwrap();
        assert!(result.is_none());
    }

    // ── list ──

    #[tokio::test]
    async fn list_returns_reports() {
        let r1 = make_report(Uuid::now_v7(), Uuid::now_v7());
        let r2 = make_report(Uuid::now_v7(), Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(2)]])
            .append_query_results([vec![r1.clone(), r2.clone()]])
            .into_connection();

        let (items, total) = ReportRepo::list(&db, None, 0, 20).await.unwrap();

        assert_eq!(items.len(), 2);
        assert_eq!(total, 2);
    }

    #[tokio::test]
    async fn list_empty() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<content_reports::Model>::new()])
            .into_connection();

        let (items, total) = ReportRepo::list(&db, None, 0, 20).await.unwrap();

        assert!(items.is_empty());
        assert_eq!(total, 0);
    }

    // ── update_status ──

    #[tokio::test]
    async fn update_status_succeeds() {
        let report = make_report(Uuid::now_v7(), Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[report.clone()]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let result = ReportRepo::update_status(&db, report.id, "resolved", Some(now())).await;
        assert!(result.is_ok());
    }
}
