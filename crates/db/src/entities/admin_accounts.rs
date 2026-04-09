use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "admin_accounts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub username: String,
    #[sea_orm(unique)]
    pub email: Option<String>,
    pub password_hash: String,
    pub name: String,
    pub managed_by: String,
    pub managed_key: String,
    pub totp_secret: Option<String>,
    pub totp_enabled: bool,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
    pub last_seen_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::admin_sessions::Entity")]
    AdminSessions,
    #[sea_orm(has_many = "super::admin_passkeys::Entity")]
    AdminPasskeys,
    #[sea_orm(has_many = "super::admin_pending_sessions::Entity")]
    AdminPendingSessions,
    #[sea_orm(has_many = "super::admin_recovery_codes::Entity")]
    AdminRecoveryCodes,
}

impl Related<super::admin_sessions::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AdminSessions.def()
    }
}

impl Related<super::admin_passkeys::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AdminPasskeys.def()
    }
}

impl Related<super::admin_pending_sessions::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AdminPendingSessions.def()
    }
}

impl Related<super::admin_recovery_codes::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AdminRecoveryCodes.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
