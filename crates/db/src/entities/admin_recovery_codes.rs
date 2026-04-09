use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "admin_recovery_codes")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub admin_id: Uuid,
    pub code_hash: String,
    pub used_at: Option<DateTimeWithTimeZone>,
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
