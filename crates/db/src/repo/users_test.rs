#[cfg(test)]
mod tests {
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use uuid::Uuid;

    use crate::entities::{devices, sessions, users};
    use crate::repo::users::UserRepo;

    fn now() -> sea_orm::prelude::DateTimeWithTimeZone {
        chrono::Utc::now().fixed_offset()
    }

    fn user_id() -> Uuid {
        Uuid::parse_str("01912345-6789-7abc-8def-0123456789ab").unwrap()
    }

    fn make_user(id: Uuid, username: &str) -> users::Model {
        users::Model {
            id,
            username: username.to_string(),
            email: Some(format!("{username}@example.com")),
            password_hash: None,
            name: username.to_string(),
            avatar_url: None,
            bio: None,
            role: "citizen".to_string(),
            institution_type: None,
            institution_name: None,
            identity_verified: false,
            identity_provider: None,
            identity_level: "basic".to_string(),
            identity_issuer: None,
            identity_verified_at: None,
            verified_name: None,
            rp_subject: None,
            municipality_id: None,
            locale: "en".to_string(),
            notification_replies: true,
            notification_mentions: true,
            notification_official: true,
            onboarding_completed_at: None,
            deleted_at: None,
            created_at: now(),
            updated_at: now(),
            last_seen_at: None,
        }
    }

    fn make_device(id: Uuid, user_id: Uuid) -> devices::Model {
        devices::Model {
            id,
            user_id,
            display_name: Some("Test Device".to_string()),
            platform: "web".to_string(),
            identity_key: None,
            matrix_curve25519_key: None,
            matrix_ed25519_key: None,
            matrix_device_signature: None,
            last_seen_at: None,
            revoked_at: None,
            fcm_token: None,
            created_at: now(),
        }
    }

    fn make_session(id: Uuid, user_id: Uuid, token_hash: &str) -> sessions::Model {
        sessions::Model {
            id,
            user_id,
            device_id: None,
            token_hash: token_hash.to_string(),
            ip_address: None,
            user_agent: None,
            expires_at: now(),
            last_used_at: None,
            revoked_at: None,
            created_at: now(),
        }
    }

    #[tokio::test]
    async fn find_by_id_returns_user() {
        let id = user_id();
        let user = make_user(id, "alice");

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[user.clone()]])
            .into_connection();

        let result = UserRepo::find_by_id(&db, id).await.unwrap();
        assert_eq!(result.unwrap().username, "alice");
    }

    #[tokio::test]
    async fn find_by_id_returns_none_when_missing() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<users::Model>::new()])
            .into_connection();

        let result = UserRepo::find_by_id(&db, user_id()).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn find_by_username_returns_active_user() {
        let user = make_user(user_id(), "bob");

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[user.clone()]])
            .into_connection();

        let result = UserRepo::find_by_username(&db, "bob").await.unwrap();
        assert_eq!(result.unwrap().id, user_id());
    }

    #[tokio::test]
    async fn find_by_username_excludes_deleted() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<users::Model>::new()])
            .into_connection();

        let result = UserRepo::find_by_username(&db, "deleted_user")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn find_by_email_returns_active_user() {
        let user = make_user(user_id(), "carol");

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[user.clone()]])
            .into_connection();

        let result = UserRepo::find_by_email(&db, "carol@example.com")
            .await
            .unwrap();
        assert_eq!(result.unwrap().username, "carol");
    }

    #[tokio::test]
    async fn find_by_email_returns_none_when_missing() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<users::Model>::new()])
            .into_connection();

        let result = UserRepo::find_by_email(&db, "nobody@example.com")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn create_inserts_and_returns_user() {
        let user = make_user(user_id(), "dave");

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[user.clone()]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let active: users::ActiveModel = user.clone().into();
        let result = UserRepo::create(&db, active).await.unwrap();
        assert_eq!(result.username, "dave");
    }

    #[tokio::test]
    async fn active_devices_returns_non_revoked() {
        let uid = user_id();
        let d1 = make_device(Uuid::now_v7(), uid);
        let d2 = make_device(Uuid::now_v7(), uid);

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![d1.clone(), d2.clone()]])
            .into_connection();

        let result = UserRepo::active_devices(&db, uid).await.unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|d| d.revoked_at.is_none()));
    }

    #[tokio::test]
    async fn active_devices_empty_when_all_revoked() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<devices::Model>::new()])
            .into_connection();

        let result = UserRepo::active_devices(&db, user_id()).await.unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn find_session_by_token_returns_active_session() {
        let session = make_session(Uuid::now_v7(), user_id(), "hash123");

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[session.clone()]])
            .into_connection();

        let result = UserRepo::find_session_by_token(&db, "hash123")
            .await
            .unwrap();
        assert_eq!(result.unwrap().token_hash, "hash123");
    }

    #[tokio::test]
    async fn find_session_by_token_returns_none_for_revoked() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<sessions::Model>::new()])
            .into_connection();

        let result = UserRepo::find_session_by_token(&db, "revoked_hash")
            .await
            .unwrap();
        assert!(result.is_none());
    }
}
