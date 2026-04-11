import { API_BASE_URL } from "./runtimeConfig";
// Import generated types used in class method signatures before the class.
import type { MapPoint as MapPointImport } from "../types/generated/MapPoint";
import type { MessageResponse } from "../types/generated/MessageResponse";
// Import frontend and admin types used by ApiClient method signatures.
import type {
  Thread,
  User,
  Club,
  ClubThread,
  ClubComment,
  Comment,
  DirectMessage,
  ExploreThread,
  FeedScope,
  LocationResult,
  Place,
  Municipality,
  ThreadWithComments,
  ThreadFilters,
  ClubFilters,
  CreateThreadData,
  CreateCommentData,
  CreateClubData,
  CreateClubThreadData,
  ClubInvitation,
  ClubInvitationWithDetails,
  AppNotification,
  Conversation,
  MapBounds,
  OsmType,
  LocationDetails,
  EntityType,
  Subscription,
  SubscribeData,
  SubscriptionCheck,
  SearchUserResult,
  SearchResults,
  TagWithCategory,
  SubmitReportData,
  SubmitAppealData,
  AppealResponse,
  MySanction,
  Device,
  ConversationWithMessages,
  GroupMember,
  GroupConversationDetail,
  CreateGroupData,
} from "../types/frontend";
import type { UserProfileResponse } from "../types/generated/UserProfileResponse";
import type {
  AdminDashboard,
  AdminUser,
  AdminUserDetail,
  AdminReport,
  AdminReportDetail,
  AdminAppeal,
  AdminAnnouncement,
  AdminInvite,
  AdminSanction,
  GeneratedAdminInvite,
  SystemAnnouncement,
  IssueSanctionData,
  TransparencyStats,
  AvailableInstitution,
  InstitutionClaim,
  WaitlistEntry,
  WaitlistStats,
} from "../types/admin";
import type { SearchThreadResult, SearchPlaceResult } from "../types/frontend";

const API_URL = API_BASE_URL;

type UnauthorizedHandler = (() => void) | null;

let unauthorizedHandler: UnauthorizedHandler = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler) {
  unauthorizedHandler = handler;
}

function shouldHandleUnauthorized(endpoint: string): boolean {
  // Auth endpoints handle 401 themselves — don't trigger global logout.
  // /auth/me is a probe (returns 401 when not logged in — normal).
  if (endpoint.startsWith("/auth/") || endpoint.startsWith("/admin/auth/")) {
    return false;
  }

  return true;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export type RegistrationMode = "invite-only" | "ftn-open";

export interface AuthConfig {
  registrationMode: RegistrationMode;
  registrationOpen: boolean;
  ftnEnabled: boolean;
}

export interface RegisterRequest {
  username: string;
  password: string;
  name: string;
  ftnToken?: string;
}

interface ApiMunicipality {
  id: string;
  name: string;
  nameFi?: string | null;
  nameSv?: string | null;
  region?: string | null;
  country?: string | null;
  population?: number | null;
  coordinates?: {
    latitude: number;
    longitude: number;
  } | null;
}

interface ApiCurrentUserProfile {
  id: string;
  username?: string;
  email?: string | null;
  name: string;
  avatarUrl?: string | null;
  bio?: string | null;
  role: "citizen" | "institution" | "moderator";
  institutionType?: string | null;
  institutionName?: string | null;
  identityVerified?: boolean;
  identityLevel?: "basic" | "substantial" | "high";
  identityProvider?: string | null;
  verifiedName?: string | null;
  municipalityId?: string | null;
  municipality?: ApiMunicipality | null;
  locale?: string;
  notificationReplies?: boolean;
  notificationMentions?: boolean;
  notificationOfficial?: boolean;
  onboardingCompletedAt?: string | null;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Private types — used only as return types by ApiClient methods.
// Not exported; callers get the types via TypeScript inference.
// These will be replaced with generated types as Rust structs gain ts-rs.
// ---------------------------------------------------------------------------

interface ThreadsResponse {
  items: Thread[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  feedScope?: FeedScope | null;
  hasSubscriptions: boolean;
}

interface ExploreResponse extends PaginatedResponse<ExploreThread> {
  feedScope: "explore";
}

interface ClubWithThreads extends Club {
  threads: ClubThread[];
}

interface ClubThreadWithComments extends ClubThread {
  memberRole?: string | null;
  comments: ClubComment[];
}

interface EditHistoryEntry {
  id: string;
  contentType: string;
  previousContent: string;
  previousContentHtml?: string | null;
  previousTitle?: string | null;
  editedAt: string;
  editor: { id: string; name: string; avatarUrl?: string };
}

interface CreatePlaceData {
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
}

interface LocationSearchResponse {
  results: LocationResult[];
  source: "cache" | "nominatim" | "mixed";
}

interface LocationWithHierarchy extends LocationResult {
  hierarchy: LocationHierarchyItem[];
}

interface TagPageResponse {
  tag: string;
  tagMeta: {
    tag: string;
    category: string;
    displayName: string | null;
    description: string | null;
    scope: string | null;
  } | null;
  institution: {
    institutionId: string;
    topicTag: string;
    relatedTags: string[];
    description: string | null;
    institutionName: string | null;
    institutionType: string | null;
  } | null;
  items: Thread[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

interface UploadAvatarResponse {
  success: boolean;
  avatarUrl: string;
}

interface UploadImageResponse {
  success: boolean;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

interface ModLogEntry {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string;
  reason: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  adminName: string;
  adminUserId: string;
}

interface LocationHierarchyItem {
  name: string;
  type: string;
  adminLevel: number | null;
}

interface TrendingItem {
  entityId: string;
  score: number;
  metadata: Record<string, unknown>;
  computedAt: string | null;
}

interface TrendingResponse {
  type: "threads" | "tags";
  items: TrendingItem[];
  computedAt: string | null;
}

interface AlgorithmDocumentation {
  name: string;
  version: string;
  updatedAt: string;
  description: Record<string, string>;
  formula: string;
  components: Record<string, unknown>;
  whatIsNotUsed: Record<string, string[]>;
  transparency: Record<string, string>;
  changelog: {
    date: string;
    version: string;
    description: Record<string, string>;
  }[];
}

type BookmarksResponse = ThreadsResponse;

interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  faviconUrl: string | null;
}

interface InstitutionManager {
  id: string;
  role: "owner" | "editor";
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  approvedAt: string | null;
  institution: {
    id: string;
    name: string;
    username: string;
    institutionType: "municipality" | "agency" | "ministry";
    institutionName: string;
    avatarUrl: string | null;
    municipalityId: string | null;
  };
}

interface CreateOrganizationData {
  name: string;
  institutionName: string;
  businessId?: string;
  businessIdCountry?: string;
  websiteUrl?: string;
  description?: string;
  institutionType?: "organization" | "agency";
}

interface CreatedOrganization {
  id: string;
  name: string;
  username: string;
  institutionType: string;
  institutionName: string;
  businessId: string | null;
}

interface InstitutionClaimWithUser {
  id: string;
  role: "owner" | "editor";
  status: "pending";
  createdAt: string;
  institution: {
    id: string;
    name: string;
    institutionName: string;
    institutionType: string;
  };
  user: { id: string; name: string; email: string };
}

function toMunicipality(
  municipality?: ApiMunicipality | null,
): Municipality | undefined {
  if (!municipality) return undefined;
  return {
    id: municipality.id,
    name: municipality.name,
    nameFi: municipality.nameFi ?? undefined,
    nameSv: municipality.nameSv ?? undefined,
    region: municipality.region ?? undefined,
    country: municipality.country ?? undefined,
    population: municipality.population ?? undefined,
    latitude: municipality.coordinates?.latitude ?? undefined,
    longitude: municipality.coordinates?.longitude ?? undefined,
  };
}

function toUser(apiUser: ApiCurrentUserProfile): User {
  const municipality = toMunicipality(apiUser.municipality);
  return {
    id: apiUser.id,
    email: apiUser.email ?? undefined,
    name: apiUser.name,
    username: apiUser.username,
    verifiedName: apiUser.verifiedName ?? undefined,
    avatarUrl: apiUser.avatarUrl ?? undefined,
    bio: apiUser.bio ?? undefined,
    role: apiUser.role,
    institutionType: apiUser.institutionType ?? undefined,
    institutionName: apiUser.institutionName ?? undefined,
    municipalityId: apiUser.municipalityId ?? municipality?.id ?? null,
    municipality: municipality ?? null,
    identityVerified: apiUser.identityVerified,
    identityLevel: apiUser.identityLevel,
    settings: {
      notificationReplies: apiUser.notificationReplies ?? true,
      notificationMentions: apiUser.notificationMentions ?? true,
      notificationOfficial: apiUser.notificationOfficial ?? true,
      locale: apiUser.locale ?? "en",
    },
    onboardingCompletedAt: apiUser.onboardingCompletedAt ?? undefined,
    createdAt: apiUser.createdAt,
  };
}

interface ContentReportResponse {
  id: string;
  status: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include", // Include cookies
    });

    if (response.status === 401 && shouldHandleUnauthorized(endpoint)) {
      queueMicrotask(() => unauthorizedHandler?.());
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(text || `Request failed with status ${response.status}`);
    }

    const data: ApiResponse<T> = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Request failed");
    }

    return data.data as T;
  }

  // Auth
  async requestMagicLink(email: string): Promise<{ message: string }> {
    return this.request("/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async login(username: string, password: string): Promise<User> {
    const response = await this.request<ApiCurrentUserProfile>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    return toUser(response);
  }

  async getAuthConfig(): Promise<AuthConfig> {
    return this.request("/auth/config");
  }

  async register(data: RegisterRequest): Promise<User> {
    const response = await this.request<ApiCurrentUserProfile>(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    return toUser(response);
  }

  async logout(): Promise<void> {
    await this.request("/auth/logout", { method: "POST" });
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.request<ApiCurrentUserProfile>("/auth/me");
    return toUser(response);
  }

  /** Fetch sanction info from /auth/me when a 403 is expected (banned/suspended). */
  async getSanctionInfo(): Promise<{
    sanctionType: "suspension" | "ban";
    reason: string | null;
    expiresAt: string | null;
  } | null> {
    const url = `${this.baseUrl}/api/v1/auth/me`;
    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.status === 403) {
        const data = await response.json();
        if (data.sanctionType) {
          return {
            sanctionType: data.sanctionType,
            reason: data.reason,
            expiresAt: data.expiresAt,
          };
        }
      }
    } catch {
      // Ignore secondary fetch errors
    }
    return null;
  }

  async verifyMagicLink(token: string): Promise<void> {
    await this.request(`/auth/verify/${token}`, {
      method: "GET",
    });
  }

  // Admin auth
  async adminMe(): Promise<{
    id: string;
    username: string;
    email: string | null;
    name: string;
  }> {
    return this.request("/admin/auth/me");
  }

  async adminLogin(
    username: string,
    password: string,
  ): Promise<{
    id: string;
    username: string;
    email: string | null;
    name: string;
  }> {
    return this.request("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  }

  async adminLogout(): Promise<void> {
    await this.request("/admin/auth/logout", { method: "POST" });
  }

  async adminChangePassword(data: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    await this.request("/admin/auth/change-password", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Users
  // Public profile endpoint returns the raw /users/:id payload, including threads.
  async getUser(id: string): Promise<UserProfileResponse> {
    return this.request<UserProfileResponse>(`/users/${id}`);
  }

  async updateProfile(data: Partial<User>): Promise<User> {
    const profilePayload: Record<string, unknown> = {};
    const settingsPayload: Record<string, unknown> = {};

    if (data.name !== undefined) profilePayload.name = data.name;
    if (data.bio !== undefined) profilePayload.bio = data.bio;
    if (data.avatarUrl !== undefined) profilePayload.avatarUrl = data.avatarUrl;
    if (data.municipalityId !== undefined)
      profilePayload.municipalityId = data.municipalityId;
    else if (data.municipality === null) profilePayload.municipalityId = null;
    else if (data.municipality?.id)
      profilePayload.municipalityId = data.municipality.id;

    if (data.settings?.locale !== undefined)
      profilePayload.locale = data.settings.locale;
    if (data.settings?.locale !== undefined)
      settingsPayload.locale = data.settings.locale;
    if (data.settings?.notificationReplies !== undefined)
      settingsPayload.notificationReplies = data.settings.notificationReplies;
    if (data.settings?.notificationMentions !== undefined)
      settingsPayload.notificationMentions = data.settings.notificationMentions;
    if (data.settings?.notificationOfficial !== undefined)
      settingsPayload.notificationOfficial = data.settings.notificationOfficial;

    if (Object.keys(settingsPayload).length > 0) {
      await this.request("/users/settings", {
        method: "PATCH",
        body: JSON.stringify(settingsPayload),
      });
    }

    if (Object.keys(profilePayload).length > 0) {
      const response = await this.request<ApiCurrentUserProfile>("/users/me", {
        method: "PATCH",
        body: JSON.stringify(profilePayload),
      });
      return toUser(response);
    }

    return this.getCurrentUser();
  }

  async changePassword(data: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ changed: boolean }> {
    return this.request("/users/me/password", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async exportData(): Promise<unknown> {
    return this.request("/users/me/data");
  }

  async deleteAccount(): Promise<{ deleted: boolean }> {
    return this.request("/users/me", { method: "DELETE" });
  }

  // Agora - Threads
  async getThreads(params?: ThreadFilters): Promise<ThreadsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.scope) searchParams.set("scope", params.scope);
    if (params?.municipalityId)
      searchParams.set("municipalityId", params.municipalityId);
    if (params?.tags?.length) searchParams.set("tags", params.tags.join(","));
    if (params?.feedScope) searchParams.set("feedScope", params.feedScope);
    if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
    if (params?.topPeriod) searchParams.set("topPeriod", params.topPeriod);
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());

    const query = searchParams.toString();
    return this.request(`/agora/threads${query ? `?${query}` : ""}`);
  }

  async getThread(
    id: string,
    sort?: "best" | "new" | "old" | "controversial",
  ): Promise<ThreadWithComments> {
    const query = sort ? `?sort=${sort}` : "";
    return this.request(`/agora/threads/${id}${query}`);
  }

  async voteComment(
    commentId: string,
    value: number,
  ): Promise<{ commentId: string; score: number; userVote: number }> {
    return this.request(`/agora/comments/${commentId}/vote`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
  }

  async voteThread(
    threadId: string,
    value: number,
  ): Promise<{ threadId: string; score: number; userVote: number }> {
    return this.request(`/agora/threads/${threadId}/vote`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
  }

  async createThread(data: CreateThreadData): Promise<Thread> {
    return this.request("/agora/threads", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async addComment(
    threadId: string,
    data: CreateCommentData,
  ): Promise<Comment> {
    return this.request(`/agora/threads/${threadId}/comments`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Agora - Edit/Delete
  async editThread(
    id: string,
    data: { title?: string; content: string },
  ): Promise<Thread> {
    return this.request(`/agora/threads/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteThread(id: string): Promise<{ deleted: boolean }> {
    return this.request(`/agora/threads/${id}`, { method: "DELETE" });
  }

  async getThreadEditHistory(threadId: string): Promise<EditHistoryEntry[]> {
    return this.request(`/agora/threads/${threadId}/edit-history`);
  }

  async editComment(id: string, content: string): Promise<Comment> {
    return this.request(`/agora/comments/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
  }

  async deleteComment(id: string): Promise<{ deleted: boolean }> {
    return this.request(`/agora/comments/${id}`, { method: "DELETE" });
  }

  async editDirectMessage(
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<DirectMessage> {
    return this.request(
      `/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ content }),
      },
    );
  }

  async deleteDirectMessage(
    conversationId: string,
    messageId: string,
  ): Promise<{ deleted: boolean }> {
    return this.request(
      `/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "DELETE",
      },
    );
  }

  async getTags(): Promise<TagWithCategory[]> {
    return this.request("/agora/tags");
  }

  async getTagPage(
    tag: string,
    page = 1,
    limit = 20,
  ): Promise<TagPageResponse> {
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", limit.toString());
    return this.request(`/agora/tags/${encodeURIComponent(tag)}?${params}`);
  }

  // Clubs
  async getClubs(params?: ClubFilters): Promise<PaginatedResponse<Club>> {
    const searchParams = new URLSearchParams();
    if (params?.category) searchParams.set("category", params.category);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.membership) searchParams.set("membership", params.membership);

    const query = searchParams.toString();
    return this.request(`/clubs${query ? `?${query}` : ""}`);
  }

  async getClub(id: string): Promise<ClubWithThreads> {
    return this.request(`/clubs/${id}`);
  }

  async createClub(data: CreateClubData): Promise<Club> {
    return this.request("/clubs", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateClub(id: string, data: Partial<CreateClubData>): Promise<Club> {
    return this.request(`/clubs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteClub(id: string): Promise<void> {
    await this.request(`/clubs/${id}`, { method: "DELETE" });
  }

  async joinClub(clubId: string): Promise<void> {
    await this.request(`/clubs/${clubId}/join`, { method: "POST" });
  }

  async leaveClub(clubId: string): Promise<void> {
    await this.request(`/clubs/${clubId}/leave`, { method: "POST" });
  }

  async listClubThreads(
    clubId: string,
    params?: { sort?: string; offset?: number; limit?: number },
  ): Promise<{ items: ClubThread[]; total: number; hasMore: boolean }> {
    const searchParams = new URLSearchParams();
    if (params?.sort) searchParams.set("sort", params.sort);
    if (params?.offset) searchParams.set("offset", String(params.offset));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    const qs = searchParams.toString();
    return this.request(`/clubs/${clubId}/threads${qs ? `?${qs}` : ""}`);
  }

  async createClubThread(
    clubId: string,
    data: CreateClubThreadData,
  ): Promise<ClubThread> {
    return this.request(`/clubs/${clubId}/threads`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getClubThread(
    clubId: string,
    threadId: string,
  ): Promise<ClubThreadWithComments> {
    return this.request(`/clubs/${clubId}/threads/${threadId}`);
  }

  async addClubComment(
    clubId: string,
    threadId: string,
    data: CreateCommentData,
  ): Promise<ClubComment> {
    return this.request(`/clubs/${clubId}/threads/${threadId}/comments`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getClubCategories(): Promise<{ category: string; count: number }[]> {
    return this.request("/clubs/meta/categories");
  }

  // Club invitations
  async inviteToClub(clubId: string, userId: string): Promise<ClubInvitation> {
    return this.request(`/clubs/${clubId}/invite`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  }

  async getClubInvitations(clubId: string): Promise<ClubInvitation[]> {
    return this.request(`/clubs/${clubId}/invitations`);
  }

  async getMyClubInvitations(): Promise<ClubInvitationWithDetails[]> {
    return this.request("/clubs/my-invitations");
  }

  async acceptClubInvitation(invitationId: string): Promise<void> {
    await this.request(`/clubs/invitations/${invitationId}/accept`, {
      method: "POST",
    });
  }

  async declineClubInvitation(invitationId: string): Promise<void> {
    await this.request(`/clubs/invitations/${invitationId}/decline`, {
      method: "POST",
    });
  }

  async cancelClubInvitation(
    clubId: string,
    invitationId: string,
  ): Promise<void> {
    await this.request(`/clubs/${clubId}/invitations/${invitationId}`, {
      method: "DELETE",
    });
  }

  // Club moderation
  async updateMemberRole(
    clubId: string,
    userId: string,
    role: string,
  ): Promise<void> {
    await this.request(`/clubs/${clubId}/members/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  }

  async removeMember(clubId: string, userId: string): Promise<void> {
    await this.request(`/clubs/${clubId}/members/${userId}`, {
      method: "DELETE",
    });
  }

  async deleteClubThread(clubId: string, threadId: string): Promise<void> {
    await this.request(`/clubs/${clubId}/threads/${threadId}`, {
      method: "DELETE",
    });
  }

  async updateClubThread(
    clubId: string,
    threadId: string,
    data: { isLocked?: boolean; isPinned?: boolean },
  ): Promise<void> {
    await this.request(`/clubs/${clubId}/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteClubComment(
    clubId: string,
    threadId: string,
    commentId: string,
  ): Promise<void> {
    await this.request(
      `/clubs/${clubId}/threads/${threadId}/comments/${commentId}`,
      { method: "DELETE" },
    );
  }

  async voteClubThread(
    clubId: string,
    threadId: string,
    value: number,
  ): Promise<{ threadId: string; score: number; userVote: number }> {
    return this.request(`/clubs/${clubId}/threads/${threadId}/vote`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
  }

  async voteClubComment(
    clubId: string,
    threadId: string,
    commentId: string,
    value: number,
  ): Promise<{ commentId: string; score: number; userVote: number }> {
    return this.request(
      `/clubs/${clubId}/threads/${threadId}/comments/${commentId}/vote`,
      {
        method: "POST",
        body: JSON.stringify({ value }),
      },
    );
  }

  // Map
  async getMapPoints(bounds: MapBounds): Promise<{ points: MapPointImport[] }> {
    const searchParams = new URLSearchParams();
    searchParams.set("north", bounds.north.toString());
    searchParams.set("south", bounds.south.toString());
    searchParams.set("east", bounds.east.toString());
    searchParams.set("west", bounds.west.toString());
    if (bounds.types) searchParams.set("types", bounds.types);
    if (bounds.categories) searchParams.set("categories", bounds.categories);
    if (bounds.timePreset) searchParams.set("timePreset", bounds.timePreset);
    if (bounds.dateFrom) searchParams.set("dateFrom", bounds.dateFrom);
    if (bounds.dateTo) searchParams.set("dateTo", bounds.dateTo);
    if (bounds.scope) searchParams.set("scope", bounds.scope);
    if (bounds.language) searchParams.set("language", bounds.language);
    if (bounds.tags) searchParams.set("tags", bounds.tags);

    return this.request(`/map/points?${searchParams.toString()}`);
  }

  async getLocationDetails(type: string, id: string): Promise<LocationDetails> {
    return this.request(`/map/location/${type}/${id}`);
  }

  async getPlaces(params?: {
    type?: string;
    category?: string;
    municipalityId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Place>> {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set("type", params.type);
    if (params?.category) searchParams.set("category", params.category);
    if (params?.municipalityId)
      searchParams.set("municipalityId", params.municipalityId);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());

    const query = searchParams.toString();
    return this.request(`/map/places${query ? `?${query}` : ""}`);
  }

  async createPlace(data: CreatePlaceData): Promise<Place> {
    return this.request("/map/places", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getPlaceCategories(): Promise<{ category: string; count: number }[]> {
    return this.request("/map/places/categories");
  }

  async getMunicipalities(): Promise<Municipality[]> {
    return this.request("/map/municipalities");
  }

  // Locations (dynamic with Nominatim)
  async searchLocations(
    query: string,
    options?: {
      country?: string;
      types?: string[];
      limit?: number;
      includeNominatim?: boolean;
    },
  ): Promise<LocationSearchResponse> {
    const params = new URLSearchParams();
    params.set("q", query);
    if (options?.country) params.set("country", options.country);
    if (options?.types?.length) params.set("types", options.types.join(","));
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.includeNominatim !== undefined)
      params.set("includeNominatim", options.includeNominatim.toString());
    return this.request(`/locations/search?${params}`);
  }

  async getLocationByOsm(
    osmType: OsmType,
    osmId: number,
  ): Promise<LocationWithHierarchy> {
    return this.request(`/locations/osm/${osmType}/${osmId}`);
  }

  async getLocation(id: string): Promise<LocationWithHierarchy> {
    return this.request(`/locations/${id}`);
  }

  // Subscriptions
  async subscribe(data: SubscribeData): Promise<Subscription> {
    return this.request("/subscriptions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async unsubscribe(
    entityType: EntityType,
    entityId: string,
  ): Promise<{ unsubscribed: boolean }> {
    return this.request(`/subscriptions/${entityType}/${entityId}`, {
      method: "DELETE",
    });
  }

  async completeOnboarding(): Promise<void> {
    return this.request("/users/me/onboarding-complete", {
      method: "POST",
    });
  }

  async getSubscriptions(): Promise<Subscription[]> {
    return this.request("/subscriptions");
  }

  async checkSubscription(
    entityType: EntityType,
    entityId: string,
  ): Promise<SubscriptionCheck> {
    return this.request(`/subscriptions/check/${entityType}/${entityId}`);
  }

  // Search
  async search(query: string, limit = 5): Promise<SearchResults> {
    return this.request(
      `/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
  }

  async searchUsers(query: string, limit = 10): Promise<SearchUserResult[]> {
    return this.request(
      `/search/users?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
  }

  async searchThreads(
    query: string,
    options?: {
      limit?: number;
      scope?: "local" | "national" | "european";
      municipalityId?: string;
      tags?: string[];
    },
  ): Promise<SearchThreadResult[]> {
    const params = new URLSearchParams();
    params.set("q", query);
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.scope) params.set("scope", options.scope);
    if (options?.municipalityId)
      params.set("municipalityId", options.municipalityId);
    if (options?.tags?.length) params.set("tags", options.tags.join(","));
    return this.request(`/search/threads?${params}`);
  }

  async searchPlaces(query: string, limit = 10): Promise<SearchPlaceResult[]> {
    return this.request(
      `/search/places?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
  }

  // Conversations (v2 endpoints — support E2EE ciphertext fields)
  async getConversations(): Promise<Conversation[]> {
    return this.request("/conversations");
  }

  async getUnreadDmCount(): Promise<{ count: number }> {
    return this.request("/conversations/unread-count");
  }

  async startConversation(userId: string): Promise<Conversation> {
    return this.request("/conversations", {
      method: "POST",
      body: JSON.stringify({
        conversationType: "direct",
        encryption: "e2ee",
        members: [userId],
      }),
    });
  }

  async getConversation(
    id: string,
    limit?: number,
  ): Promise<ConversationWithMessages> {
    // Pure v2 path — fetch conversation metadata + messages in parallel.
    const [conv, messagesResp] = await Promise.all([
      this.request<{
        id: string;
        encryption: string;
        members: Array<{
          userId: string;
          name: string;
          avatarUrl?: string | null;
          role: string;
        }>;
      }>(`/conversations/${id}`),
      this.request<MessageResponse[]>(
        `/conversations/${id}/messages${limit ? `?limit=${limit}` : ""}`,
      ),
    ]);

    const memberById = new Map(conv.members.map((m) => [m.userId, m]));

    // API returns newest-first for cursor pagination; reverse to
    // chronological (oldest-first) for chat rendering.
    const messages: DirectMessage[] = messagesResp
      .map((m) => {
        const member = memberById.get(m.senderId);
        return {
          id: m.id,
          conversationId: m.conversationId,
          content: m.content ?? null,
          ciphertext: m.ciphertext || undefined,
          senderDeviceId: m.senderDeviceId ?? undefined,
          senderId: m.senderId,
          messageType: m.messageType,
          author: member
            ? {
                id: member.userId,
                name: member.name,
                avatarUrl: member.avatarUrl ?? null,
                role: "citizen" as const,
              }
            : null,
          createdAt: m.serverTs,
        };
      })
      .reverse();

    return {
      id: conv.id,
      encryption: conv.encryption as "e2ee" | "none",
      otherUser: null, // DM page derives from members
      members: conv.members,
      messages,
    };
  }

  async getConversationMessages(
    conversationId: string,
    options?: {
      limit?: number;
      before?: string;
      messageType?: string;
    },
  ): Promise<MessageResponse[]> {
    const params = new URLSearchParams();
    if (options?.limit) {
      params.set("limit", String(options.limit));
    }
    if (options?.before) {
      params.set("before", options.before);
    }
    if (options?.messageType) {
      params.set("messageType", options.messageType);
    }

    const query = params.toString();
    return this.request<MessageResponse[]>(
      `/conversations/${conversationId}/messages${query ? `?${query}` : ""}`,
    );
  }

  async markConversationRead(conversationId: string): Promise<void> {
    await this.request(`/conversations/${conversationId}/read`, {
      method: "POST",
    });
  }

  async sendDirectMessage(
    conversationId: string,
    data: { content: string },
  ): Promise<MessageResponse> {
    return this.request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // E2EE Device management
  async registerDevice(data: {
    displayName: string;
    platform: string;
    pairingCode?: string;
  }): Promise<Device> {
    return this.request("/devices", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createDevicePairingCode(): Promise<{
    code: string;
    expiresAt: string;
  }> {
    return this.request("/devices/pairing-codes", {
      method: "POST",
    });
  }

  async listDevices(): Promise<Device[]> {
    return this.request("/devices");
  }

  async bindCurrentSessionToDevice(deviceId: string): Promise<void> {
    await this.request(`/devices/${deviceId}/bind`, {
      method: "POST",
    });
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.request(`/devices/${deviceId}`, { method: "DELETE" });
  }

  async getUserDevices(userId: string): Promise<Device[]> {
    return this.request(`/users/${userId}/devices`);
  }

  async uploadMatrixKeys(
    deviceId: string,
    data: {
      device_keys?: {
        user_id: string;
        device_id: string;
        keys: Record<string, string>;
        signatures: Record<string, Record<string, string>>;
      };
      one_time_keys?: Record<
        string,
        {
          key: string;
          signatures: Record<string, Record<string, string>>;
        }
      >;
      fallback_keys?: Record<
        string,
        {
          key: string;
          signatures: Record<string, Record<string, string>>;
        }
      >;
    },
  ): Promise<{ one_time_key_counts: Record<string, number> }> {
    return this.request(`/devices/${deviceId}/matrix/keys/upload`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async queryMatrixKeys(data: {
    device_keys: Record<string, string[]>;
    timeout?: number;
    token?: string;
  }): Promise<{
    device_keys: Record<string, Record<string, unknown>>;
    master_keys: Record<string, unknown>;
    self_signing_keys: Record<string, unknown>;
    failures: Record<string, unknown>;
  }> {
    return this.request("/devices/matrix/keys/query", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async claimMatrixKeys(data: {
    one_time_keys: Record<string, Record<string, string>>;
    timeout?: number;
  }): Promise<{
    one_time_keys: Record<string, Record<string, Record<string, unknown>>>;
    failures: Record<string, unknown>;
  }> {
    return this.request("/devices/matrix/keys/claim", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async sendEncryptedDirectMessage(
    conversationId: string,
    data: {
      deviceCiphertexts: Record<string, string>;
      senderDeviceId: string;
    },
  ): Promise<DirectMessage> {
    return this.request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Group conversations
  async createGroupConversation(data: CreateGroupData): Promise<Conversation> {
    return this.request("/conversations", {
      method: "POST",
      body: JSON.stringify({
        conversationType: "group",
        encryption: "e2ee",
        ...data,
      }),
    });
  }

  async getGroupConversation(
    id: string,
    limit?: number,
  ): Promise<GroupConversationDetail> {
    const [meta, members, messagesResp, protocolMessagesResp] =
      await Promise.all([
        this.request<{
          id: string;
          encryption: string;
          name: string | null;
          description: string | null;
          currentEpoch: number;
        }>(`/conversations/${id}`),
        this.getGroupMembers(id),
        this.getConversationMessages(id, { limit }),
        this.getConversationMessages(id, {
          limit: 100,
          messageType: "to_device",
        }),
      ]);

    const memberById = new Map(members.map((m) => [m.userId, m]));
    const toDirectMessage = (m: MessageResponse): DirectMessage => {
      const member = memberById.get(m.senderId);
      return {
        id: m.id,
        conversationId: m.conversationId,
        content: m.content ?? null,
        ciphertext: m.ciphertext || undefined,
        senderDeviceId: m.senderDeviceId ?? undefined,
        senderId: m.senderId,
        messageType: m.messageType,
        author: member
          ? {
              id: member.userId,
              name: member.name,
              avatarUrl: member.avatarUrl ?? null,
              role: "citizen" as const,
            }
          : null,
        createdAt: m.serverTs,
      };
    };

    // API returns newest-first for cursor pagination; reverse to
    // chronological (oldest-first) for chat rendering.
    const messages = messagesResp.map(toDirectMessage).reverse();
    const protocolMessagesById = new Map(
      protocolMessagesResp.map((message) => [
        message.id,
        toDirectMessage(message),
      ]),
    );

    return {
      id: meta.id,
      name: meta.name ?? "Group",
      description: meta.description,
      encryption: meta.encryption,
      currentEpoch: meta.currentEpoch,
      members,
      messages,
      protocolMessages: [...protocolMessagesById.values()],
    };
  }

  async getGroupConversationState(id: string): Promise<{
    currentEpoch: number;
    members: GroupMember[];
  }> {
    const [meta, members] = await Promise.all([
      this.request<{ currentEpoch: number }>(`/conversations/${id}`),
      this.getGroupMembers(id),
    ]);

    return {
      currentEpoch: meta.currentEpoch,
      members,
    };
  }

  async getGroupMembers(conversationId: string): Promise<GroupMember[]> {
    return this.request(`/conversations/${conversationId}/members`);
  }

  async inviteGroupMember(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    await this.request(`/conversations/${conversationId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  }

  async removeGroupMember(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    await this.request(`/conversations/${conversationId}/members/${userId}`, {
      method: "DELETE",
    });
  }

  async sendGroupMessage(
    conversationId: string,
    data: { ciphertext: string; senderDeviceId: string },
  ): Promise<DirectMessage> {
    return this.request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Send a hidden Matrix to-device payload through the group device queue. */
  async sendGroupToDevice(
    conversationId: string,
    data: {
      deviceCiphertexts: Record<string, string>;
      senderDeviceId: string;
    },
  ): Promise<void> {
    return this.request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ ...data, messageType: "to_device" }),
    });
  }

  // Notifications
  async getNotifications(limit?: number): Promise<AppNotification[]> {
    const query = limit ? `?limit=${limit}` : "";
    const res = await this.request<{ items: AppNotification[] }>(
      `/notifications${query}`,
    );
    return res.items;
  }

  async getUnreadNotificationCount(): Promise<{ count: number }> {
    return this.request("/notifications/unread-count");
  }

  async markNotificationRead(id: string): Promise<void> {
    await this.request(`/notifications/${id}/read`, { method: "POST" });
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.request("/notifications/read-all", { method: "POST" });
  }

  async deleteNotification(id: string): Promise<void> {
    await this.request(`/notifications/${id}`, { method: "DELETE" });
  }

  // Push notifications
  async getPushVapidKey(): Promise<{
    enabled: boolean;
    vapidPublicKey: string | null;
  }> {
    return this.request("/notifications/push/vapid-public-key");
  }

  async subscribePush(subscription: PushSubscription): Promise<void> {
    const json = subscription.toJSON();
    await this.request("/notifications/push/subscribe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      }),
    });
  }

  async unsubscribePush(endpoint: string): Promise<void> {
    await this.request("/notifications/push/subscribe", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    });
  }

  // Native push device token (FCM)
  async registerDeviceToken(
    token: string,
    platform: "android" | "ios",
    deviceId?: string,
  ): Promise<void> {
    await this.request("/notifications/push/device-token", {
      method: "POST",
      body: JSON.stringify({ token, platform, deviceId }),
    });
  }

  async unregisterDeviceToken(token: string): Promise<void> {
    await this.request("/notifications/push/device-token", {
      method: "DELETE",
      body: JSON.stringify({ token }),
    });
  }

  // Uploads
  async uploadAvatar(file: File): Promise<UploadAvatarResponse> {
    const formData = new FormData();
    formData.append("file", file);

    const url = `${this.baseUrl}/api/v1/uploads/avatar`;
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    const ct = response.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      throw new Error((await response.text()) || "Upload failed");
    }
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Upload failed");
    }

    return data.data;
  }

  async deleteAvatar(): Promise<void> {
    await this.request("/uploads/avatar", { method: "DELETE" });
  }

  async uploadImage(file: File): Promise<UploadImageResponse> {
    const formData = new FormData();
    formData.append("file", file);

    const url = `${this.baseUrl}/api/v1/uploads/image`;
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    const ct = response.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      throw new Error((await response.text()) || "Upload failed");
    }
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Upload failed");
    }

    return data.data;
  }

  // ─── Admin API ────────────────────────────────────────────

  async getAdminDashboard(): Promise<AdminDashboard> {
    return this.request("/admin/dashboard");
  }

  async getAdminUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
  }): Promise<PaginatedResponse<AdminUser>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.role) searchParams.set("role", params.role);
    const query = searchParams.toString();
    return this.request(`/admin/users${query ? `?${query}` : ""}`);
  }

  async getAdminUser(id: string): Promise<AdminUserDetail> {
    return this.request(`/admin/users/${id}`);
  }

  async changeUserRole(
    id: string,
    role: "citizen" | "institution",
  ): Promise<{ id: string; role: string }> {
    return this.request(`/admin/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  }

  async toggleVerification(
    id: string,
    verified: boolean,
  ): Promise<{ id: string; identityVerified: boolean }> {
    return this.request(`/admin/users/${id}/verify`, {
      method: "PATCH",
      body: JSON.stringify({ verified }),
    });
  }

  async issueSanction(
    userId: string,
    data: IssueSanctionData,
  ): Promise<AdminSanction> {
    return this.request(`/admin/users/${userId}/sanction`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getUserSanctions(userId: string): Promise<AdminSanction[]> {
    return this.request(`/admin/users/${userId}/sanctions`);
  }

  async revokeSanction(sanctionId: string): Promise<{ revoked: boolean }> {
    return this.request(`/admin/sanctions/${sanctionId}`, { method: "DELETE" });
  }

  async getAdminReports(params?: {
    page?: number;
    limit?: number;
    status?: string;
    reason?: string;
    contentType?: string;
  }): Promise<PaginatedResponse<AdminReport>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.status) searchParams.set("status", params.status);
    if (params?.reason) searchParams.set("reason", params.reason);
    if (params?.contentType)
      searchParams.set("contentType", params.contentType);
    const query = searchParams.toString();
    return this.request(`/admin/reports${query ? `?${query}` : ""}`);
  }

  async getAdminReport(id: string): Promise<AdminReportDetail> {
    return this.request(`/admin/reports/${id}`);
  }

  async updateReport(
    id: string,
    data: { status: string; reason?: string },
  ): Promise<{ id: string; status: string }> {
    return this.request(`/admin/reports/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async removeContent(
    type: string,
    id: string,
    reason?: string,
  ): Promise<{ hidden: boolean }> {
    return this.request(`/admin/content/${type}/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    });
  }

  async restoreContent(
    type: string,
    id: string,
  ): Promise<{ restored: boolean }> {
    return this.request(`/admin/content/${type}/${id}/restore`, {
      method: "POST",
    });
  }

  async getModLog(params?: {
    page?: number;
    limit?: number;
    actionType?: string;
    adminId?: string;
  }): Promise<PaginatedResponse<ModLogEntry>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.actionType) searchParams.set("actionType", params.actionType);
    if (params?.adminId) searchParams.set("adminId", params.adminId);
    const query = searchParams.toString();
    return this.request(`/admin/modlog${query ? `?${query}` : ""}`);
  }

  async getTransparencyStats(
    from?: string,
    to?: string,
  ): Promise<TransparencyStats> {
    const searchParams = new URLSearchParams();
    if (from) searchParams.set("from", from);
    if (to) searchParams.set("to", to);
    const query = searchParams.toString();
    return this.request(`/admin/transparency${query ? `?${query}` : ""}`);
  }

  async getAdminAppeals(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResponse<AdminAppeal>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    return this.request(`/admin/appeals${query ? `?${query}` : ""}`);
  }

  async resolveAppeal(
    id: string,
    data: { status: "accepted" | "rejected"; adminResponse: string },
  ): Promise<{ id: string; status: string }> {
    return this.request(`/admin/appeals/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // ─── Admin settings ──────────────────────────────

  async getAdminSettings(): Promise<{
    registrationOpen: boolean;
  }> {
    return this.request("/admin/settings");
  }

  async updateAdminSettings(data: {
    registrationOpen?: boolean;
  }): Promise<void> {
    return this.request("/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async generateAdminInvites(count: number): Promise<GeneratedAdminInvite[]> {
    return this.request("/admin/invites/generate", {
      method: "POST",
      body: JSON.stringify({ count }),
    });
  }

  async getAdminInvites(
    status?: "available" | "used" | "revoked",
  ): Promise<AdminInvite[]> {
    const searchParams = new URLSearchParams();
    if (status) searchParams.set("status", status);
    const query = searchParams.toString();
    return this.request(`/admin/invites${query ? `?${query}` : ""}`);
  }

  // ─── User reports & appeals ──────────────────────────────

  async submitReport(data: SubmitReportData): Promise<ContentReportResponse> {
    return this.request("/reports", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async submitAppeal(data: SubmitAppealData): Promise<AppealResponse> {
    return this.request("/reports/appeal", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getMySanctions(): Promise<MySanction[]> {
    return this.request("/reports/my-sanctions");
  }

  // ─── Discovery ────────────────────────────────────────────

  async getExplore(params?: {
    page?: number;
    limit?: number;
    scope?: string;
  }): Promise<ExploreResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.scope) searchParams.set("scope", params.scope);
    const query = searchParams.toString();
    return this.request(`/discover/explore${query ? `?${query}` : ""}`);
  }

  async getTrending(
    type: "threads" | "tags" = "threads",
    limit = 10,
  ): Promise<TrendingResponse> {
    return this.request(`/discover/trending?type=${type}&limit=${limit}`);
  }

  async getAlgorithm(): Promise<AlgorithmDocumentation> {
    return this.request("/discover/algorithm");
  }

  // ─── Bookmarks ────────────────────────────────────────────

  async addBookmark(
    threadId: string,
  ): Promise<{ threadId: string; bookmarked: boolean }> {
    return this.request("/bookmarks", {
      method: "POST",
      body: JSON.stringify({ threadId }),
    });
  }

  async removeBookmark(
    threadId: string,
  ): Promise<{ threadId: string; bookmarked: boolean }> {
    return this.request(`/bookmarks/${threadId}`, { method: "DELETE" });
  }

  async getBookmarks(params?: {
    page?: number;
    limit?: number;
  }): Promise<BookmarksResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    const query = searchParams.toString();
    return this.request(`/bookmarks${query ? `?${query}` : ""}`);
  }

  // ─── View tracking ────────────────────────────────────────

  async recordView(threadId: string): Promise<void> {
    await this.request(`/agora/threads/${threadId}/view`, { method: "POST" });
  }

  // Link previews
  async getLinkPreview(url: string): Promise<LinkPreviewData> {
    return this.request(`/link-preview?url=${encodeURIComponent(url)}`);
  }

  // System announcements (public)
  async getAnnouncements(): Promise<SystemAnnouncement[]> {
    return this.request("/announcements");
  }

  // Admin announcements
  async createAnnouncement(data: {
    title: string;
    message: string;
    type: "info" | "warning" | "critical";
    expiresAt?: string;
  }): Promise<SystemAnnouncement> {
    return this.request("/admin/announcements", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getAdminAnnouncements(): Promise<AdminAnnouncement[]> {
    return this.request("/admin/announcements");
  }

  async toggleAnnouncement(id: string, active: boolean): Promise<void> {
    return this.request(`/admin/announcements/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });
  }

  async deleteAnnouncement(id: string): Promise<void> {
    return this.request(`/admin/announcements/${id}`, {
      method: "DELETE",
    });
  }

  // ─── Institution Management ────────────────────────────────

  async getMyInstitutions(): Promise<InstitutionManager[]> {
    return this.request("/institutions/my");
  }

  async getAvailableInstitutions(): Promise<AvailableInstitution[]> {
    return this.request("/institutions/available");
  }

  async claimInstitution(
    institutionId: string,
    role: "owner" | "editor" = "owner",
  ): Promise<InstitutionClaim> {
    return this.request(`/institutions/${institutionId}/claim`, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
  }

  async checkInstitutionAccess(
    institutionId: string,
  ): Promise<{ canManage: boolean; role: string | null }> {
    return this.request(`/institutions/${institutionId}/check`);
  }

  async createOrganization(
    data: CreateOrganizationData,
  ): Promise<CreatedOrganization> {
    return this.request("/institutions/create", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Admin: institution claims
  async getInstitutionClaims(): Promise<InstitutionClaimWithUser[]> {
    return this.request("/institutions/claims");
  }

  async updateInstitutionClaim(
    claimId: string,
    status: "approved" | "rejected",
  ): Promise<{ status: string }> {
    return this.request(`/institutions/claims/${claimId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  // Waitlist (public)
  async joinWaitlist(
    email: string,
    name?: string,
    locale?: string,
  ): Promise<{ message: string; position?: number }> {
    return this.request("/waitlist/join", {
      method: "POST",
      body: JSON.stringify({ email, name, locale }),
    });
  }

  // Waitlist (admin)
  async getWaitlist(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<{
    items: WaitlistEntry[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    return this.request(`/waitlist/admin${query ? `?${query}` : ""}`);
  }

  async getWaitlistStats(): Promise<WaitlistStats> {
    return this.request("/waitlist/admin/stats");
  }

  async approveWaitlistEntry(
    id: string,
  ): Promise<{ id: string; status: string; code: string; emailSent: boolean }> {
    return this.request(`/waitlist/admin/${id}/approve`, { method: "POST" });
  }

  async rejectWaitlistEntry(
    id: string,
    note?: string,
  ): Promise<{ id: string; status: string }> {
    return this.request(`/waitlist/admin/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
  }

  async bulkApproveWaitlist(ids: string[]): Promise<{
    processed: number;
    results: { id: string; code: string; emailSent: boolean }[];
  }> {
    return this.request("/waitlist/admin/bulk-approve", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
  }
}

// =============================================================================
// Types — generated from Rust via ts-rs where possible.
// Import the generated base types; extend with frontend-only fields.
// Do NOT manually duplicate fields that exist in the generated types.
// =============================================================================

// Re-export all types so existing `import { X } from "../lib/api"` keeps working.
// New code should import types from ../types/api, ../types/frontend, or ../types/admin.
//
// Generated types (types/api) — skip names that collide with frontend overrides.
export type {
  ClubRole,
  GroupRole,
  ThreadScope,
  ThreadSource,
  MapPointType,
  InvitationStatus,
  ThreadResponse,
  ThreadWithCommentsResponse,
  CommentResponse,
  AuthorSummary,
  TagWithCount,
  VoteResponse,
  ClubResponse,
  ClubListResponse,
  InvitationResponse,
  InvitationClubSummary,
  InvitationUserSummary,
  ConversationListItem,
  ConversationResponse,
  ConversationUserSummary,
  LastMessageSummary,
  MemberSummary,
  MessageResponse,
  EpochResponse,
  MapPoint,
  PlaceResponse,
  MunicipalityResponse,
  LocationResponse,
  UserProfileResponse,
  ReportResponse,
  SanctionResponse,
} from "../types/api";
// Frontend-only and admin types.
export * from "../types/frontend";
export * from "../types/admin";

// Export singleton instance
export const api = new ApiClient(API_URL);
