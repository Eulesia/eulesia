use chrono::{DateTime, Utc};
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
// ConversationType enum
// ---------------------------------------------------------------------------

/// Conversation type — closed set matching the DB CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageType {
    Text,
    Media,
    System,
    Reaction,
    Redaction,
}

impl MessageType {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Media => "media",
            Self::System => "system",
            Self::Reaction => "reaction",
            Self::Redaction => "redaction",
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
            other => Err(format!("invalid message type: {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// Moderation enums
// ---------------------------------------------------------------------------

/// Content report status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
pub struct Paginated<T> {
    pub data: Vec<T>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
}

/// Pagination query parameters.
#[derive(Debug, Deserialize)]
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
