use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "admin_pending_sessions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub admin_id: Uuid,
    pub token_hash: String,
    #[sea_orm(column_type = "Json", nullable)]
    pub webauthn_state: Option<serde_json::Value>,
    pub totp_secret_temp: Option<String>,
    pub expires_at: DateTimeWithTimeZone,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::admin_accounts::Entity",
        from = "Column::AdminId",
        to = "super::admin_accounts::Column::Id"
    )]
    AdminAccount,
}

impl Related<super::admin_accounts::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AdminAccount.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
