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
mod m20260407_000018_jobs_geo_foundation;
mod m20260407_000019_places_source_identity_index;
mod m20260408_000020_clean_municipality_duplicates;
mod m20260408_000021_thread_scope_personal;
// NOTE: m20260408_000022_nuke_messages is intentionally NOT registered in
// Migrator. It is an opt-in, out-of-band emergency migration that truncates
// messaging tables (gated behind EULESIA_ALLOW_NUKE_MESSAGES). It lives here
// for discoverability but must never run as part of the normal migration
// sequence.
mod m20260408_000023_add_skd_message_type;
mod m20260409_000022_municipality_designation;
mod m20260424_000024_device_pairing_tokens;
mod m20260424_000025_matrix_crypto_keys;
mod m20260424_000026_replace_skd_with_to_device_message_type;
mod m20260424_000027_drop_legacy_device_prekeys;

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
            Box::new(m20260407_000018_jobs_geo_foundation::Migration),
            Box::new(m20260407_000019_places_source_identity_index::Migration),
            Box::new(m20260408_000020_clean_municipality_duplicates::Migration),
            Box::new(m20260408_000021_thread_scope_personal::Migration),
            Box::new(m20260409_000022_municipality_designation::Migration),
            Box::new(m20260408_000023_add_skd_message_type::Migration),
            Box::new(m20260424_000024_device_pairing_tokens::Migration),
            Box::new(m20260424_000025_matrix_crypto_keys::Migration),
            Box::new(m20260424_000026_replace_skd_with_to_device_message_type::Migration),
            Box::new(m20260424_000027_drop_legacy_device_prekeys::Migration),
        ]
    }
}
