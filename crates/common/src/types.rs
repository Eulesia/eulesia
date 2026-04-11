use chrono::{DateTime, Utc};
use sea_orm::DeriveActiveEnum;
use sea_orm::entity::prelude::{EnumIter, StringLen};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Unique identifier for all entities. Uses `UUIDv7` (time-sortable).
pub type Id = Uuid;

/// Generate a new time-sortable ID.
pub fn new_id() -> Id {
    Uuid::now_v7()
}

// ---------------------------------------------------------------------------
// Strongly-typed ID newtypes
// ---------------------------------------------------------------------------

/// Strongly-typed user identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UserId(pub Uuid);

impl From<Uuid> for UserId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

impl From<UserId> for Uuid {
    fn from(id: UserId) -> Self {
        id.0
    }
}

impl std::fmt::Display for UserId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Strongly-typed device identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceId(pub Uuid);

impl From<Uuid> for DeviceId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

impl From<DeviceId> for Uuid {
    fn from(id: DeviceId) -> Self {
        id.0
    }
}

impl std::fmt::Display for DeviceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Strongly-typed session identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionId(pub Uuid);

impl From<Uuid> for SessionId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

impl From<SessionId> for Uuid {
    fn from(id: SessionId) -> Self {
        id.0
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Strongly-typed thread identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ThreadId(pub Uuid);

impl From<Uuid> for ThreadId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

impl From<ThreadId> for Uuid {
    fn from(id: ThreadId) -> Self {
        id.0
    }
}

impl std::fmt::Display for ThreadId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Strongly-typed comment identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CommentId(pub Uuid);

impl From<Uuid> for CommentId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

impl From<CommentId> for Uuid {
    fn from(id: CommentId) -> Self {
        id.0
    }
}

impl std::fmt::Display for CommentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Strongly-typed conversation identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConversationId(pub Uuid);

impl From<Uuid> for ConversationId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

impl From<ConversationId> for Uuid {
    fn from(id: ConversationId) -> Self {
        id.0
    }
}

impl std::fmt::Display for ConversationId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Strongly-typed membership identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MembershipId(pub Uuid);

impl From<Uuid> for MembershipId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

impl From<MembershipId> for Uuid {
    fn from(id: MembershipId) -> Self {
        id.0
    }
}

impl std::fmt::Display for MembershipId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

// ---------------------------------------------------------------------------
// Platform enum
// ---------------------------------------------------------------------------

/// Device platform — closed set matching the DB CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Web,
    Android,
    Ios,
    Desktop,
}

impl Platform {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Android => "android",
            Self::Ios => "ios",
            Self::Desktop => "desktop",
        }
    }
}

impl std::fmt::Display for Platform {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for Platform {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "web" => Ok(Self::Web),
            "android" => Ok(Self::Android),
            "ios" => Ok(Self::Ios),
            "desktop" => Ok(Self::Desktop),
            other => Err(format!("invalid platform: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// UserRole enum
// ---------------------------------------------------------------------------

/// Platform user role — closed set matching the DB CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Citizen,
    Institution,
    Moderator,
}

impl UserRole {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Citizen => "citizen",
            Self::Institution => "institution",
            Self::Moderator => "moderator",
        }
    }

    pub const fn is_moderator(&self) -> bool {
        matches!(self, Self::Moderator)
    }
}

impl std::fmt::Display for UserRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for UserRole {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "citizen" => Ok(Self::Citizen),
            "institution" => Ok(Self::Institution),
            "moderator" => Ok(Self::Moderator),
            other => Err(format!("invalid role: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// GroupRole enum
// ---------------------------------------------------------------------------

/// Conversation membership role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum GroupRole {
    Member,
    Owner,
}

impl GroupRole {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Member => "member",
            Self::Owner => "owner",
        }
    }

    pub const fn is_owner(&self) -> bool {
        matches!(self, Self::Owner)
    }
}

impl std::fmt::Display for GroupRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for GroupRole {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "member" => Ok(Self::Member),
            "owner" => Ok(Self::Owner),
            other => Err(format!("invalid group role: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// ClubRole enum
// ---------------------------------------------------------------------------

/// Club/room membership role — closed set matching the DB values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ClubRole {
    Member,
    Moderator,
    Owner,
}

impl ClubRole {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Member => "member",
            Self::Moderator => "moderator",
            Self::Owner => "owner",
        }
    }

    pub const fn is_owner(&self) -> bool {
        matches!(self, Self::Owner)
    }

    pub const fn is_at_least_moderator(&self) -> bool {
        matches!(self, Self::Moderator | Self::Owner)
    }
}

impl std::fmt::Display for ClubRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for ClubRole {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "member" => Ok(Self::Member),
            "moderator" => Ok(Self::Moderator),
            "owner" => Ok(Self::Owner),
            other => Err(format!("invalid club role: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// ConversationType enum
// ---------------------------------------------------------------------------

/// Conversation type — closed set matching the DB CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ConversationType {
    Direct,
    Group,
    Channel,
}

impl ConversationType {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Group => "group",
            Self::Channel => "channel",
        }
    }
}

impl std::fmt::Display for ConversationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for ConversationType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "direct" => Ok(Self::Direct),
            "group" => Ok(Self::Group),
            "channel" => Ok(Self::Channel),
            other => Err(format!("invalid conversation type: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// MessageType enum
// ---------------------------------------------------------------------------

/// Message type — closed set matching the DB CHECK constraint.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum MessageType {
    #[default]
    Text,
    Media,
    System,
    Reaction,
    Redaction,
    /// Hidden Matrix to-device payload routed through the existing per-device
    /// message queue for key distribution and protocol maintenance.
    #[serde(rename = "to_device")]
    ToDevice,
}

impl MessageType {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Media => "media",
            Self::System => "system",
            Self::Reaction => "reaction",
            Self::Redaction => "redaction",
            Self::ToDevice => "to_device",
        }
    }
}

impl std::fmt::Display for MessageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for MessageType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "text" => Ok(Self::Text),
            "media" => Ok(Self::Media),
            "system" => Ok(Self::System),
            "reaction" => Ok(Self::Reaction),
            "redaction" => Ok(Self::Redaction),
            "to_device" => Ok(Self::ToDevice),
            other => Err(format!("invalid message type: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// Moderation enums
// ---------------------------------------------------------------------------

/// Content report status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ReportStatus {
    Pending,
    Reviewing,
    Resolved,
    Dismissed,
}

impl ReportStatus {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Reviewing => "reviewing",
            Self::Resolved => "resolved",
            Self::Dismissed => "dismissed",
        }
    }
}

impl std::fmt::Display for ReportStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for ReportStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(Self::Pending),
            "reviewing" => Ok(Self::Reviewing),
            "resolved" => Ok(Self::Resolved),
            "dismissed" => Ok(Self::Dismissed),
            other => Err(format!("invalid report status: {other}")),
        }
    }
}

/// Content report reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ReportReason {
    Illegal,
    Harassment,
    Spam,
    Misinformation,
    Other,
}

impl ReportReason {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Illegal => "illegal",
            Self::Harassment => "harassment",
            Self::Spam => "spam",
            Self::Misinformation => "misinformation",
            Self::Other => "other",
        }
    }
}

impl std::fmt::Display for ReportReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for ReportReason {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "illegal" => Ok(Self::Illegal),
            "harassment" => Ok(Self::Harassment),
            "spam" => Ok(Self::Spam),
            "misinformation" => Ok(Self::Misinformation),
            "other" => Ok(Self::Other),
            other => Err(format!("invalid report reason: {other}")),
        }
    }
}

/// User sanction type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum SanctionType {
    Warning,
    Suspension,
    Ban,
}

impl SanctionType {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Warning => "warning",
            Self::Suspension => "suspension",
            Self::Ban => "ban",
        }
    }
}

impl std::fmt::Display for SanctionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for SanctionType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "warning" => Ok(Self::Warning),
            "suspension" => Ok(Self::Suspension),
            "ban" => Ok(Self::Ban),
            other => Err(format!("invalid sanction type: {other}")),
        }
    }
}

/// Moderation appeal status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum AppealStatus {
    Pending,
    Accepted,
    Rejected,
}

impl AppealStatus {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
        }
    }
}

impl std::fmt::Display for AppealStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for AppealStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(Self::Pending),
            "accepted" => Ok(Self::Accepted),
            "rejected" => Ok(Self::Rejected),
            other => Err(format!("invalid appeal status: {other}")),
        }
    }
}

/// Standard timestamp type.
pub type Timestamp = DateTime<Utc>;

/// Standard paginated response wrapper.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Paginated<T> {
    #[serde(rename = "items")]
    pub data: Vec<T>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
}

/// Pagination query parameters.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationParams {
    #[serde(default = "default_offset")]
    pub offset: i64,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

const fn default_offset() -> i64 {
    0
}

const fn default_limit() -> i64 {
    50
}

// ---------------------------------------------------------------------------
// ThreadScope enum
// ---------------------------------------------------------------------------

/// Agora thread scope — determines visibility and feed placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ThreadScope {
    Local,
    National,
    European,
    Personal,
    Club,
}

impl ThreadScope {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::National => "national",
            Self::European => "european",
            Self::Personal => "personal",
            Self::Club => "club",
        }
    }
}

impl std::fmt::Display for ThreadScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for ThreadScope {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "local" => Ok(Self::Local),
            "national" => Ok(Self::National),
            "european" => Ok(Self::European),
            "personal" => Ok(Self::Personal),
            "club" => Ok(Self::Club),
            other => Err(format!("invalid thread scope: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// ThreadSource enum
// ---------------------------------------------------------------------------

/// How a thread was created.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "snake_case")]
pub enum ThreadSource {
    User,
    MinutesImport,
    RssImport,
    Summary,
}

impl ThreadSource {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::MinutesImport => "minutes_import",
            Self::RssImport => "rss_import",
            Self::Summary => "summary",
        }
    }
}

impl std::fmt::Display for ThreadSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for ThreadSource {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "user" => Ok(Self::User),
            "minutes_import" => Ok(Self::MinutesImport),
            "rss_import" => Ok(Self::RssImport),
            other => Err(format!("invalid thread source: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// MapPointType enum
// ---------------------------------------------------------------------------

/// Type of point on the map.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum MapPointType {
    Thread,
    Club,
    Place,
    Municipality,
}

impl MapPointType {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Thread => "thread",
            Self::Club => "club",
            Self::Place => "place",
            Self::Municipality => "municipality",
        }
    }
}

impl std::fmt::Display for MapPointType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for MapPointType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "thread" => Ok(Self::Thread),
            "club" => Ok(Self::Club),
            "place" => Ok(Self::Place),
            "municipality" => Ok(Self::Municipality),
            other => Err(format!("invalid map point type: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// Geo types
// ---------------------------------------------------------------------------

/// Geographic coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct Coordinates {
    pub latitude: f64,
    pub longitude: f64,
}

impl Coordinates {
    pub fn from_options(lat: Option<f64>, lon: Option<f64>) -> Option<Self> {
        Some(Self {
            latitude: lat?,
            longitude: lon?,
        })
    }
}

/// Geographic bounding box.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub south: f64,
    pub north: f64,
    pub west: f64,
    pub east: f64,
}

// ---------------------------------------------------------------------------
// JobStatus enum
// ---------------------------------------------------------------------------

/// Execution status of a background job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::None)")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    #[sea_orm(string_value = "running")]
    Running,
    #[sea_orm(string_value = "skipped")]
    Skipped,
    #[sea_orm(string_value = "succeeded")]
    Succeeded,
    #[sea_orm(string_value = "failed")]
    Failed,
}

impl JobStatus {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Skipped => "skipped",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }
}

impl std::fmt::Display for JobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for JobStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "running" => Ok(Self::Running),
            "skipped" => Ok(Self::Skipped),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            other => Err(format!("invalid job status: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// Location enums
// ---------------------------------------------------------------------------

/// Type of location (OSM-inspired).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::None)")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum LocationType {
    #[sea_orm(string_value = "municipality")]
    Municipality,
    #[sea_orm(string_value = "place")]
    Place,
    #[sea_orm(string_value = "region")]
    Region,
    #[sea_orm(string_value = "country")]
    Country,
    #[sea_orm(string_value = "district")]
    District,
    #[sea_orm(string_value = "locality")]
    Locality,
    #[sea_orm(string_value = "neighborhood")]
    Neighborhood,
    #[sea_orm(string_value = "other")]
    Other,
}

impl LocationType {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Municipality => "municipality",
            Self::Place => "place",
            Self::Region => "region",
            Self::Country => "country",
            Self::District => "district",
            Self::Locality => "locality",
            Self::Neighborhood => "neighborhood",
            Self::Other => "other",
        }
    }
}

impl std::fmt::Display for LocationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for LocationType {
    type Err = std::convert::Infallible;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "municipality" => Ok(Self::Municipality),
            "place" => Ok(Self::Place),
            "region" => Ok(Self::Region),
            "country" => Ok(Self::Country),
            "district" => Ok(Self::District),
            "locality" => Ok(Self::Locality),
            "neighborhood" => Ok(Self::Neighborhood),
            _ => Ok(Self::Other),
        }
    }
}

/// Operational status of a location.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::None)")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum LocationStatus {
    #[sea_orm(string_value = "active")]
    Active,
    #[sea_orm(string_value = "inactive")]
    Inactive,
    #[sea_orm(string_value = "archived")]
    Archived,
}

impl LocationStatus {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Inactive => "inactive",
            Self::Archived => "archived",
        }
    }
}

impl std::fmt::Display for LocationStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for LocationStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "inactive" => Ok(Self::Inactive),
            "archived" => Ok(Self::Archived),
            other => Err(format!("invalid location status: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// SyncStatus enum
// ---------------------------------------------------------------------------

/// Synchronization status for external data sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::None)")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum SyncStatus {
    #[sea_orm(string_value = "pending")]
    Pending,
    #[sea_orm(string_value = "synced")]
    Synced,
    #[sea_orm(string_value = "failed")]
    Failed,
    #[sea_orm(string_value = "manual")]
    Manual,
}

impl SyncStatus {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Synced => "synced",
            Self::Failed => "failed",
            Self::Manual => "manual",
        }
    }
}

impl std::fmt::Display for SyncStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for SyncStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(Self::Pending),
            "synced" => Ok(Self::Synced),
            "failed" => Ok(Self::Failed),
            "manual" => Ok(Self::Manual),
            other => Err(format!("invalid sync status: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// InvitationStatus enum
// ---------------------------------------------------------------------------

/// Club/room invitation status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum InvitationStatus {
    Pending,
    Accepted,
    Declined,
}

impl InvitationStatus {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Declined => "declined",
        }
    }
}

impl std::fmt::Display for InvitationStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for InvitationStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(Self::Pending),
            "accepted" => Ok(Self::Accepted),
            "declined" => Ok(Self::Declined),
            other => Err(format!("invalid invitation status: {other}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    // -- Helper: round-trip as_str -> from_str for any type that has both ------

    fn roundtrip<T>(variant: T, expected: &str)
    where
        T: std::fmt::Display + FromStr + PartialEq + std::fmt::Debug,
        T::Err: std::fmt::Debug,
    {
        // Display == as_str
        assert_eq!(variant.to_string(), expected);
        // from_str round-trip
        let parsed: T = expected.parse().unwrap();
        assert_eq!(parsed, variant);
    }

    // ---- Platform -----------------------------------------------------------

    #[test]
    fn platform_roundtrip() {
        roundtrip(Platform::Web, "web");
        roundtrip(Platform::Android, "android");
        roundtrip(Platform::Ios, "ios");
        roundtrip(Platform::Desktop, "desktop");
    }

    #[test]
    fn platform_invalid_string_fails() {
        assert!(Platform::from_str("windows").is_err());
    }

    // ---- UserRole -----------------------------------------------------------

    #[test]
    fn user_role_roundtrip() {
        roundtrip(UserRole::Citizen, "citizen");
        roundtrip(UserRole::Institution, "institution");
        roundtrip(UserRole::Moderator, "moderator");
    }

    #[test]
    fn user_role_is_moderator() {
        assert!(UserRole::Moderator.is_moderator());
        assert!(!UserRole::Citizen.is_moderator());
        assert!(!UserRole::Institution.is_moderator());
    }

    #[test]
    fn user_role_invalid_string_fails() {
        assert!(UserRole::from_str("admin").is_err());
    }

    // ---- ClubRole -----------------------------------------------------------

    #[test]
    fn club_role_roundtrip() {
        roundtrip(ClubRole::Member, "member");
        roundtrip(ClubRole::Moderator, "moderator");
        roundtrip(ClubRole::Owner, "owner");
    }

    #[test]
    fn club_role_is_owner() {
        assert!(ClubRole::Owner.is_owner());
        assert!(!ClubRole::Moderator.is_owner());
        assert!(!ClubRole::Member.is_owner());
    }

    #[test]
    fn club_role_is_at_least_moderator() {
        assert!(ClubRole::Moderator.is_at_least_moderator());
        assert!(ClubRole::Owner.is_at_least_moderator());
        assert!(!ClubRole::Member.is_at_least_moderator());
    }

    // ---- JobStatus ----------------------------------------------------------

    #[test]
    fn job_status_roundtrip() {
        roundtrip(JobStatus::Running, "running");
        roundtrip(JobStatus::Skipped, "skipped");
        roundtrip(JobStatus::Succeeded, "succeeded");
        roundtrip(JobStatus::Failed, "failed");
    }

    // ---- LocationType -------------------------------------------------------

    #[test]
    fn location_type_roundtrip() {
        roundtrip(LocationType::Municipality, "municipality");
        roundtrip(LocationType::Place, "place");
        roundtrip(LocationType::Region, "region");
        roundtrip(LocationType::Country, "country");
        roundtrip(LocationType::District, "district");
        roundtrip(LocationType::Locality, "locality");
        roundtrip(LocationType::Neighborhood, "neighborhood");
        roundtrip(LocationType::Other, "other");
    }

    #[test]
    fn location_type_fallback_to_other() {
        // Any unknown string should parse as Other
        assert_eq!(LocationType::from_str("city").unwrap(), LocationType::Other);
        assert_eq!(
            LocationType::from_str("something_else").unwrap(),
            LocationType::Other
        );
    }

    // ---- LocationStatus -----------------------------------------------------

    #[test]
    fn location_status_roundtrip() {
        roundtrip(LocationStatus::Active, "active");
        roundtrip(LocationStatus::Inactive, "inactive");
        roundtrip(LocationStatus::Archived, "archived");
    }

    // ---- SyncStatus ---------------------------------------------------------

    #[test]
    fn sync_status_roundtrip() {
        roundtrip(SyncStatus::Pending, "pending");
        roundtrip(SyncStatus::Synced, "synced");
        roundtrip(SyncStatus::Failed, "failed");
        roundtrip(SyncStatus::Manual, "manual");
    }

    #[test]
    fn club_role_ord_member_lt_moderator_lt_owner() {
        assert!(ClubRole::Member < ClubRole::Moderator);
        assert!(ClubRole::Moderator < ClubRole::Owner);
        assert!(ClubRole::Member < ClubRole::Owner);
    }

    #[test]
    fn club_role_invalid_string_fails() {
        assert!(ClubRole::from_str("admin").is_err());
    }

    // ---- ThreadScope --------------------------------------------------------

    #[test]
    fn thread_scope_roundtrip() {
        roundtrip(ThreadScope::Local, "local");
        roundtrip(ThreadScope::National, "national");
        roundtrip(ThreadScope::European, "european");
        roundtrip(ThreadScope::Club, "club");
    }

    #[test]
    fn thread_scope_invalid_string_fails() {
        assert!(ThreadScope::from_str("global").is_err());
    }

    // ---- ThreadSource -------------------------------------------------------

    #[test]
    fn thread_source_roundtrip() {
        roundtrip(ThreadSource::User, "user");
        roundtrip(ThreadSource::MinutesImport, "minutes_import");
        roundtrip(ThreadSource::RssImport, "rss_import");
    }

    #[test]
    fn thread_source_invalid_string_fails() {
        assert!(ThreadSource::from_str("api").is_err());
    }

    // ---- MapPointType -------------------------------------------------------

    #[test]
    fn map_point_type_roundtrip() {
        roundtrip(MapPointType::Thread, "thread");
        roundtrip(MapPointType::Club, "club");
        roundtrip(MapPointType::Place, "place");
        roundtrip(MapPointType::Municipality, "municipality");
    }

    #[test]
    fn map_point_type_invalid_string_fails() {
        assert!(MapPointType::from_str("region").is_err());
    }

    // ---- InvitationStatus ---------------------------------------------------

    #[test]
    fn invitation_status_roundtrip() {
        roundtrip(InvitationStatus::Pending, "pending");
        roundtrip(InvitationStatus::Accepted, "accepted");
        roundtrip(InvitationStatus::Declined, "declined");
    }

    #[test]
    fn invitation_status_invalid_string_fails() {
        assert!(InvitationStatus::from_str("expired").is_err());
    }

    // ---- new_id / UUIDv7 ----------------------------------------------------

    #[test]
    fn new_id_generates_valid_uuidv7() {
        let id = new_id();
        assert!(!id.is_nil());
        assert_eq!(id.get_version(), Some(uuid::Version::SortRand));
    }

    #[test]
    fn new_id_is_unique() {
        let a = new_id();
        let b = new_id();
        assert_ne!(a, b);
    }

    // ---- ID newtype conversions ---------------------------------------------

    #[test]
    fn user_id_uuid_roundtrip() {
        let raw = Uuid::now_v7();
        let uid = UserId::from(raw);
        let back: Uuid = uid.into();
        assert_eq!(raw, back);
    }

    #[test]
    fn device_id_uuid_roundtrip() {
        let raw = Uuid::now_v7();
        let did = DeviceId::from(raw);
        let back: Uuid = did.into();
        assert_eq!(raw, back);
    }

    #[test]
    fn session_id_uuid_roundtrip() {
        let raw = Uuid::now_v7();
        let sid = SessionId::from(raw);
        let back: Uuid = sid.into();
        assert_eq!(raw, back);
    }

    #[test]
    fn thread_id_uuid_roundtrip() {
        let raw = Uuid::now_v7();
        let tid = ThreadId::from(raw);
        let back: Uuid = tid.into();
        assert_eq!(raw, back);
    }

    #[test]
    fn user_id_display() {
        let raw = Uuid::now_v7();
        let uid = UserId(raw);
        assert_eq!(uid.to_string(), raw.to_string());
    }

    // ---- GroupRole ----------------------------------------------------------

    #[test]
    fn group_role_roundtrip() {
        roundtrip(GroupRole::Member, "member");
        roundtrip(GroupRole::Owner, "owner");
    }

    #[test]
    fn group_role_is_owner() {
        assert!(GroupRole::Owner.is_owner());
        assert!(!GroupRole::Member.is_owner());
    }

    #[test]
    fn group_role_invalid_string_fails() {
        assert!(GroupRole::from_str("admin").is_err());
    }

    // ---- ConversationType ---------------------------------------------------

    #[test]
    fn conversation_type_roundtrip() {
        roundtrip(ConversationType::Direct, "direct");
        roundtrip(ConversationType::Group, "group");
        roundtrip(ConversationType::Channel, "channel");
    }

    #[test]
    fn conversation_type_invalid_string_fails() {
        assert!(ConversationType::from_str("broadcast").is_err());
    }

    // ---- MessageType --------------------------------------------------------

    #[test]
    fn message_type_roundtrip() {
        roundtrip(MessageType::Text, "text");
        roundtrip(MessageType::Media, "media");
        roundtrip(MessageType::System, "system");
        roundtrip(MessageType::Reaction, "reaction");
        roundtrip(MessageType::Redaction, "redaction");
        roundtrip(MessageType::ToDevice, "to_device");
    }

    #[test]
    fn message_type_default_is_text() {
        assert_eq!(MessageType::default(), MessageType::Text);
    }

    #[test]
    fn message_type_invalid_string_fails() {
        assert!(MessageType::from_str("audio").is_err());
    }

    // ---- ReportStatus -------------------------------------------------------

    #[test]
    fn report_status_roundtrip() {
        roundtrip(ReportStatus::Pending, "pending");
        roundtrip(ReportStatus::Reviewing, "reviewing");
        roundtrip(ReportStatus::Resolved, "resolved");
        roundtrip(ReportStatus::Dismissed, "dismissed");
    }

    #[test]
    fn report_status_invalid_string_fails() {
        assert!(ReportStatus::from_str("closed").is_err());
    }

    // ---- ReportReason -------------------------------------------------------

    #[test]
    fn report_reason_roundtrip() {
        roundtrip(ReportReason::Illegal, "illegal");
        roundtrip(ReportReason::Harassment, "harassment");
        roundtrip(ReportReason::Spam, "spam");
        roundtrip(ReportReason::Misinformation, "misinformation");
        roundtrip(ReportReason::Other, "other");
    }

    #[test]
    fn report_reason_invalid_string_fails() {
        assert!(ReportReason::from_str("violence").is_err());
    }

    // ---- SanctionType -------------------------------------------------------

    #[test]
    fn sanction_type_roundtrip() {
        roundtrip(SanctionType::Warning, "warning");
        roundtrip(SanctionType::Suspension, "suspension");
        roundtrip(SanctionType::Ban, "ban");
    }

    #[test]
    fn sanction_type_invalid_string_fails() {
        assert!(SanctionType::from_str("mute").is_err());
    }

    // ---- AppealStatus -------------------------------------------------------

    #[test]
    fn appeal_status_roundtrip() {
        roundtrip(AppealStatus::Pending, "pending");
        roundtrip(AppealStatus::Accepted, "accepted");
        roundtrip(AppealStatus::Rejected, "rejected");
    }

    #[test]
    fn appeal_status_invalid_string_fails() {
        assert!(AppealStatus::from_str("withdrawn").is_err());
    }
}
