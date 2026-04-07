pub use sea_orm_migration::prelude::*;

mod m20260403_000001_initial;
mod m20260403_000002_content_moderation_geo;
mod m20260403_000003_notifications;
mod m20260404_000004_thread_views;
mod m20260404_000005_fix_role_constraints;
mod m20260404_000006_plaintext_messaging;
mod m20260404_000007_auth_ftn_magiclink;
mod m20260405_000008_subscriptions;
mod m20260405_000009_clubs_institutions_waitlist;
mod m20260405_000010_dm_unread_count;
mod m20260405_000011_admin_features;
mod m20260406_000012_admin_accounts;
mod m20260406_000013_club_enrichment;
mod m20260406_000014_club_role_owner;
mod m20260407_000015_admin_actor_fks;
mod m20260407_000016_modlog_indexes;
mod m20260407_000017_thread_scope_club;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260403_000001_initial::Migration),
            Box::new(m20260403_000002_content_moderation_geo::Migration),
            Box::new(m20260403_000003_notifications::Migration),
            Box::new(m20260404_000004_thread_views::Migration),
            Box::new(m20260404_000005_fix_role_constraints::Migration),
            Box::new(m20260404_000006_plaintext_messaging::Migration),
            Box::new(m20260404_000007_auth_ftn_magiclink::Migration),
            Box::new(m20260405_000008_subscriptions::Migration),
            Box::new(m20260405_000009_clubs_institutions_waitlist::Migration),
            Box::new(m20260405_000010_dm_unread_count::Migration),
            Box::new(m20260405_000011_admin_features::Migration),
            Box::new(m20260406_000012_admin_accounts::Migration),
            Box::new(m20260406_000013_club_enrichment::Migration),
            Box::new(m20260406_000014_club_role_owner::Migration),
            Box::new(m20260407_000015_admin_actor_fks::Migration),
            Box::new(m20260407_000016_modlog_indexes::Migration),
            Box::new(m20260407_000017_thread_scope_club::Migration),
        ]
    }
}
