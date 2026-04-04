#[cfg(test)]
mod tests {
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use uuid::Uuid;

    use crate::entities::moderation_actions;
    use crate::repo::moderation_actions_repo::ModerationActionRepo;

    fn now() -> sea_orm::prelude::DateTimeWithTimeZone {
        chrono::Utc::now().fixed_offset()
    }

    fn make_action(id: Uuid, admin_id: Uuid) -> moderation_actions::Model {
        moderation_actions::Model {
            id,
            admin_id,
            action_type: "hide_content".to_string(),
            target_type: "thread".to_string(),
            target_id: Uuid::now_v7(),
            report_id: Some(Uuid::now_v7()),
            reason: Some("violates guidelines".to_string()),
            metadata: None,
            created_at: now(),
        }
    }

    // ── create ──

    #[tokio::test]
    async fn create_returns_action() {
        let action = make_action(Uuid::now_v7(), Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[action.clone()]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let active: moderation_actions::ActiveModel = action.clone().into();
        let result = ModerationActionRepo::create(&db, active).await.unwrap();
        assert_eq!(result.action_type, "hide_content");
    }

    // ── list_for_report ──

    #[tokio::test]
    async fn list_for_report_returns_actions() {
        let report_id = Uuid::now_v7();
        let mut a1 = make_action(Uuid::now_v7(), Uuid::now_v7());
        a1.report_id = Some(report_id);
        let mut a2 = make_action(Uuid::now_v7(), Uuid::now_v7());
        a2.report_id = Some(report_id);

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![a1.clone(), a2.clone()]])
            .into_connection();

        let result = ModerationActionRepo::list_for_report(&db, report_id)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
    }
}
