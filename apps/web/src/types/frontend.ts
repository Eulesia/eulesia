// Frontend-only types — domain types, request types, UI unions.
// These are NOT generated from Rust; they exist only in the frontend.

import type { ThreadScope } from "./generated/ThreadScope";
import type { InvitationStatus } from "./generated/InvitationStatus";

export interface User {
  id: string;
  email?: string | null;
  name: string;
  username?: string;
  verifiedName?: string;
  avatarUrl?: string | null;
  bio?: string | null;
  role: "citizen" | "institution" | "moderator";
  institutionType?: string;
  institutionName?: string;
  municipalityId?: string | null;
  municipality?: Municipality | null;
  identityVerified?: boolean;
  identityLevel?: "basic" | "substantial" | "high";
  settings?: {
    notificationReplies: boolean;
    notificationMentions: boolean;
    notificationOfficial: boolean;
    locale: string;
  };
  onboardingCompletedAt?: string | null;
  hasPassword?: boolean;
  createdAt?: string;
  // UI-computed fields (added by transformAuthor or component logic)
  avatarInitials?: string;
  verified?: boolean;
  canViewProfile?: boolean;
}

export interface Municipality {
  id: string;
  name: string;
  nameFi?: string;
  nameSv?: string;
  region?: string;
  country?: string;
  population?: number | null;
  latitude?: number;
  longitude?: number;
}

export interface Thread {
  id: string;
  title: string;
  content: string;
  contentHtml?: string;
  scope: ThreadScope;
  tags: string[];
  author?: UserSummary;
  authorId?: string | null;
  municipality?: Municipality;
  municipalityId?: string;
  municipalityName?: string | null;
  institutionalContext?: InstitutionalContext;
  replyCount: number;
  score?: number;
  viewCount?: number;
  userVote?: number;
  isBookmarked?: boolean;
  isPinned?: boolean;
  isLocked?: boolean;
  editedAt?: string | null;
  editedBy?: string | null;
  editorName?: string | null;
  createdAt: string;
  updatedAt: string;
  // AI/Import source tracking
  source?: string;
  sourceUrl?: string;
  sourceId?: string;
  aiGenerated?: boolean;
  sourceInstitutionId?: string;
  sourceInstitutionName?: string;
}

export interface ThreadWithComments extends Thread {
  comments: Comment[];
}

export interface CvsBreakdown {
  engagement: number;
  sourceQuality: number;
  freshness: number;
  total: number;
}

export interface ExploreThread extends Thread {
  cvsScore: number;
  scoreBreakdown: CvsBreakdown;
}

export interface Comment {
  id: string;
  threadId: string;
  content: string;
  contentHtml?: string;
  author: UserSummary | null;
  authorId?: string | null;
  parentId?: string | null;
  score: number;
  depth: number;
  userVote: number;
  editedAt?: string | null;
  editedBy?: string | null;
  isHidden?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface UserSummary {
  id: string;
  username?: string;
  name: string;
  avatarUrl?: string | null;
  role: "citizen" | "institution" | "moderator";
  // Present on full user profiles, absent on embedded author summaries
  identityVerified?: boolean;
  canViewProfile?: boolean;
  institutionType?: string;
  institutionName?: string;
}

export interface InstitutionalContext {
  docs?: { title: string; url: string }[];
  timeline?: { date: string; event: string }[];
  faq?: { q: string; a: string }[];
  contact?: string;
}

export interface Club {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  category?: string | null;
  isPublic: boolean;
  creatorId: string;
  creator?: ClubMemberSummary | null;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  rules?: string[] | string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  memberCount: number;
  isMember: boolean;
  memberRole?: "member" | "moderator" | "owner" | null;
  moderators?: ClubMemberSummary[];
  members?: ClubMemberSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface ClubMemberSummary {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role: "member" | "moderator" | "owner";
  canViewProfile?: boolean;
}

export type ClubMember = ClubMemberSummary;

export interface ClubInvitation {
  id: string;
  clubId: string;
  clubName?: string | null;
  club?: {
    id: string;
    name: string;
    slug: string;
    avatarUrl?: string | null;
    coverImageUrl?: string | null;
    memberCount?: number;
  } | null;
  userId: string;
  invitee?: { id: string; name: string; avatarUrl?: string | null } | null;
  invitedBy: string;
  inviter?: { id: string; name: string; avatarUrl?: string | null } | null;
  status: InvitationStatus;
  createdAt: string;
}

export type ClubInvitationWithDetails = ClubInvitation;

export interface ClubThread {
  id: string;
  title: string;
  content: string;
  contentHtml?: string;
  author: UserSummary;
  authorId?: string | null;
  isPinned: boolean;
  isLocked: boolean;
  replyCount: number;
  score?: number;
  userVote?: number;
  createdAt: string;
  updatedAt: string;
}

export type ClubComment = Comment;

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  conversationType: string;
  name?: string | null;
  currentEpoch: number;
  otherUser: { id: string; name: string; avatarUrl?: string | null } | null;
  lastMessage: {
    id: string;
    content?: string | null;
    senderId: string;
    createdAt: string;
  } | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  /** Plaintext content — may be null/absent for E2EE messages. */
  content?: string | null;
  contentHtml?: string;
  /** Base64url-encoded ciphertext envelope, present for E2EE messages. */
  ciphertext?: string;
  /** Device ID of the sender, present for E2EE messages. */
  senderDeviceId?: string;
  /** Raw sender ID from the v2 API — used when author is not populated. */
  senderId?: string;
  /** Message type (text, media, system, to_device, etc.). */
  messageType?: string;
  author: UserSummary | null;
  editedAt?: string | null;
  isHidden?: boolean;
  createdAt: string;
}

export type FeedScope =
  | "following"
  | "local"
  | "national"
  | "european"
  | "personal"
  | "all";

// E2EE Device types
export interface Device {
  id: string;
  userId?: string;
  displayName?: string | null;
  platform: string;
  createdAt: string;
  lastActiveAt?: string;
}

export interface ConversationWithMessages {
  id: string;
  encryption?: "e2ee" | "none";
  otherUser: UserSummary | null;
  /** All members — used by DM page to derive otherUser. */
  members?: Array<{
    userId: string;
    name: string;
    avatarUrl?: string | null;
  }>;
  messages: DirectMessage[];
}

export interface GroupMember {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  role: "owner" | "member";
  joinedEpoch: number;
}

export interface GroupConversationDetail {
  id: string;
  name: string;
  description?: string | null;
  encryption: string;
  currentEpoch: number;
  members: GroupMember[];
  messages: DirectMessage[];
  protocolMessages: DirectMessage[];
}

export interface CreateGroupData {
  name: string;
  description?: string;
  members: string[];
}
export type SortBy = "recent" | "new" | "top";

export type TopPeriod = "day" | "week" | "month" | "year";

export interface ThreadFilters {
  scope?: "local" | "national" | "european" | "personal";
  municipalityId?: string;
  tags?: string[];
  feedScope?: FeedScope;
  sortBy?: SortBy;
  topPeriod?: TopPeriod;
  page?: number;
  limit?: number;
}

export interface ClubFilters {
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
  membership?: "mine";
}

export interface CreateThreadData {
  title?: string;
  content: string;
  scope: "local" | "national" | "european" | "personal";
  country?: string;
  municipalityId?: string;
  // Location support: either locationId (existing) or locationOsmId (to be activated)
  locationId?: string;
  locationOsmId?: number;
  locationOsmType?: OsmType;
  tags?: string[];
  language?: string;
  institutionalContext?: InstitutionalContext;
}

export interface CreateCommentData {
  content: string;
  parentId?: string;
  language?: string;
}

export interface CreateClubData {
  name: string;
  slug?: string;
  description?: string;
  rules?: string[];
  category?: string;
  coverImageUrl?: string;
  isPublic?: boolean;
  latitude?: number;
  longitude?: number;
  address?: string;
  municipalityId?: string;
}

export interface CreateClubThreadData {
  title: string;
  content: string;
  language?: string;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  types?: string;
  categories?: string;
  dateFrom?: string;
  dateTo?: string;
  timePreset?: "week" | "month" | "year" | "all";
  scope?: string;
  language?: string;
  tags?: string;
}

export interface Place {
  id: string;
  name: string;
  nameFi?: string;
  nameSv?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  geojson?: unknown;
  type: "poi" | "area" | "route" | "landmark";
  category?: string;
  municipalityId?: string;
  createdAt: string;
}

export interface LocationDetails {
  id: string;
  name: string;
  coordinates?: { latitude: number; longitude: number };
  threads?: Thread[];
  clubs?: Club[];
  municipality?: Municipality;
  place?: Place;
}

export type OsmType = "node" | "way" | "relation";

export type LocationStatus = "active" | "available";

export interface LocationResult {
  id: string | null; // DB ID (null if from Nominatim only)
  osmId: number | null;
  osmType: OsmType | null;
  name: string;
  nameFi: string | null;
  nameSv: string | null;
  nameEn: string | null;
  displayName: string;
  type: string; // 'municipality', 'village', 'region', etc.
  adminLevel: number | null;
  country: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  bounds: { south: number; north: number; west: number; east: number } | null;
  population: number | null;
  status: LocationStatus; // 'active' = in DB, 'available' = from Nominatim
  contentCount: number;
  parent: {
    name: string;
    type: string;
  } | null;
}

export type EntityType = "user" | "municipality" | "place" | "club" | "tag";

export type NotifyLevel = "all" | "none" | "highlights";

export interface Subscription {
  entityType: EntityType;
  entityId: string;
  notify: NotifyLevel;
  createdAt: string;
  entity: Record<string, unknown> | null;
}

export interface SubscribeData {
  entityType: EntityType;
  entityId: string;
  notify?: NotifyLevel;
}

export interface SubscriptionCheck {
  subscribed: boolean;
  notify: NotifyLevel | null;
}

export interface SearchUserResult {
  id: string;
  name: string;
  username: string;
  role: "citizen" | "institution" | "moderator";
  avatarUrl?: string;
  institutionType?: string;
  institutionName?: string;
  municipalityName?: string;
}

export interface SearchThreadResult {
  id: string;
  title: string;
  content: string;
  scope: "local" | "national" | "european";
  authorName: string;
  municipalityName?: string;
  tags: string[];
  score: number;
  replyCount: number;
  createdAt: string;
}

export interface SearchPlaceResult {
  id: string;
  name: string;
  description?: string;
  category?: string;
  municipalityName?: string;
}

export interface SearchMunicipalityResult {
  id: string;
  name: string;
  nameFi: string;
  region?: string;
}

export interface SearchLocationResult {
  id: string;
  osmId: number;
  osmType: string;
  name: string;
  nameFi?: string;
  displayName: string;
  type: string;
  country: string;
  coordinates?: { latitude: number; longitude: number };
  contentCount: number;
  parentName?: string;
}

export interface SearchTagResult {
  tag: string;
  count: number;
}

export interface SearchClubResult {
  id: string;
  name: string;
  slug: string;
  description?: string;
  category?: string;
  memberCount: number;
}

export interface SearchResults {
  users: SearchUserResult[];
  threads: SearchThreadResult[];
  places: SearchPlaceResult[];
  municipalities: SearchMunicipalityResult[];
  locations: SearchLocationResult[];
  tags: SearchTagResult[];
  clubs: SearchClubResult[];
  query: string;
  processingTimeMs: number;
}

export type TagWithCategory = import("./generated/TagWithCount").TagWithCount;

export interface SubmitReportData {
  contentType: string;
  contentId: string;
  reason: string;
  description?: string;
}

export interface SubmitAppealData {
  sanctionId?: string;
  reportId?: string;
  actionId?: string;
  reason: string;
}

export interface AppealResponse {
  id: string;
  status: string;
  createdAt: string;
}

export interface MySanction {
  id: string;
  sanctionType: "warning" | "suspension" | "ban";
  reason?: string;
  issuedAt: string;
  expiresAt?: string;
  revokedAt?: string;
}
