use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "device_pairing_tokens")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub user_id: Uuid,
    pub created_by_device_id: Option<Uuid>,
    pub code_hash: String,
    pub used_at: Option<DateTimeWithTimeZone>,
    pub used_by_device_id: Option<Uuid>,
    pub expires_at: DateTimeWithTimeZone,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::UserId",
        to = "super::users::Column::Id"
    )]
    User,
    #[sea_orm(
        belongs_to = "super::devices::Entity",
        from = "Column::CreatedByDeviceId",
        to = "super::devices::Column::Id"
    )]
    CreatedByDevice,
    #[sea_orm(
        belongs_to = "super::devices::Entity",
        from = "Column::UsedByDeviceId",
        to = "super::devices::Column::Id"
    )]
    UsedByDevice,
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
