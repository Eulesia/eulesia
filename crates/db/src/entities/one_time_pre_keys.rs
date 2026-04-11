use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "one_time_pre_keys")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub device_id: Uuid,
    pub key_id: i64,
    #[sea_orm(column_type = "VarBinary(StringLen::None)")]
    pub key_data: Vec<u8>,
    #[sea_orm(column_type = "VarBinary(StringLen::None)", nullable)]
    pub key_signature: Option<Vec<u8>>,
    pub key_algorithm: Option<String>,
    pub matrix_key_id: Option<String>,
    pub is_fallback: bool,
    pub uploaded_at: DateTimeWithTimeZone,
    pub consumed_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::devices::Entity",
        from = "Column::DeviceId",
        to = "super::devices::Column::Id"
    )]
    Device,
}

impl Related<super::devices::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Device.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
