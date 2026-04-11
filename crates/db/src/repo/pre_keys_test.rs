#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, Value};
    use uuid::Uuid;

    use crate::entities::one_time_pre_keys;
    use crate::repo::pre_keys::PreKeyRepo;

    fn count_result(n: i64) -> BTreeMap<String, Value> {
        BTreeMap::from([("num_items".to_string(), Value::BigInt(Some(n)))])
    }

    fn make_matrix_key(device_id: Uuid, matrix_key_id: &str) -> one_time_pre_keys::ActiveModel {
        one_time_pre_keys::ActiveModel {
            id: sea_orm::ActiveValue::Set(Uuid::now_v7()),
            device_id: sea_orm::ActiveValue::Set(device_id),
            key_id: sea_orm::ActiveValue::Set(1),
            key_data: sea_orm::ActiveValue::Set(vec![1, 2, 3]),
            key_signature: sea_orm::ActiveValue::Set(Some(vec![4, 5, 6])),
            key_algorithm: sea_orm::ActiveValue::Set(Some("signed_curve25519".to_string())),
            matrix_key_id: sea_orm::ActiveValue::Set(Some(matrix_key_id.to_string())),
            is_fallback: sea_orm::ActiveValue::Set(false),
            uploaded_at: sea_orm::ActiveValue::Set(chrono::Utc::now().fixed_offset()),
            consumed_at: sea_orm::ActiveValue::Set(None),
        }
    }

    #[tokio::test]
    async fn count_available_matrix_keys_returns_count() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(1)]])
            .into_connection();

        let result = PreKeyRepo::count_available_matrix_keys(&db, Uuid::now_v7())
            .await
            .unwrap();
        assert_eq!(result, 1);
    }

    #[tokio::test]
    async fn count_available_matrix_keys_zero() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .into_connection();

        let result = PreKeyRepo::count_available_matrix_keys(&db, Uuid::now_v7())
            .await
            .unwrap();
        assert_eq!(result, 0);
    }

    #[tokio::test]
    async fn upload_matrix_one_time_keys_matches_partial_unique_index() {
        let device_id = Uuid::now_v7();
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .append_query_results([[count_result(1)]])
            .into_connection();

        let inserted = PreKeyRepo::upload_matrix_one_time_keys(
            &db,
            vec![make_matrix_key(device_id, "signed_curve25519:AAAA")],
        )
        .await
        .unwrap();

        assert_eq!(inserted, 1);

        let logs = db.into_transaction_log();
        let insert_sql = logs[1].statements()[0].sql.as_str();
        assert!(
            insert_sql.contains(
                r#"ON CONFLICT ("device_id", "matrix_key_id") WHERE "matrix_key_id" IS NOT NULL DO NOTHING"#
            ),
            "unexpected insert sql: {insert_sql}"
        );
    }
}
