use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "devices")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub user_id: Uuid,
    pub display_name: Option<String>,
    pub platform: String,
    #[sea_orm(column_type = "VarBinary(StringLen::None)", nullable)]
    pub identity_key: Option<Vec<u8>>,
    #[sea_orm(column_type = "VarBinary(StringLen::None)", nullable)]
    pub matrix_curve25519_key: Option<Vec<u8>>,
    #[sea_orm(column_type = "VarBinary(StringLen::None)", nullable)]
    pub matrix_ed25519_key: Option<Vec<u8>>,
    #[sea_orm(column_type = "VarBinary(StringLen::None)", nullable)]
    pub matrix_device_signature: Option<Vec<u8>>,
    pub last_seen_at: Option<DateTimeWithTimeZone>,
    pub revoked_at: Option<DateTimeWithTimeZone>,
    pub fcm_token: Option<String>,
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
    #[sea_orm(has_many = "super::one_time_pre_keys::Entity")]
    OneTimePreKeys,
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
