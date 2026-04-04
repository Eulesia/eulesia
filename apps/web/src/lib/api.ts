import { API_BASE_URL } from "./runtimeConfig";

const API_URL = API_BASE_URL;

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
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  }

  async getAuthConfig(): Promise<AuthConfig> {
    return this.request("/auth/config");
  }

  async register(data: RegisterRequest): Promise<User> {
    return this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async logout(): Promise<void> {
    await this.request("/auth/logout", { method: "POST" });
  }

  async getCurrentUser(): Promise<User> {
    return this.request("/auth/me");
  }

  // Users
  async getUser(id: string): Promise<User> {
    return this.request(`/users/${id}`);
  }

  async updateProfile(data: Partial<User>): Promise<User> {
    return this.request("/users/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
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

  // Room threads
  async createRoomThread(
    roomId: string,
    data: { title: string; content: string },
  ): Promise<RoomThread> {
    return this.request(`/home/rooms/${roomId}/threads`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getRoomThread(
    roomId: string,
    threadId: string,
  ): Promise<RoomThreadWithComments> {
    return this.request(`/home/rooms/${roomId}/threads/${threadId}`);
  }

  async addRoomComment(
    roomId: string,
    threadId: string,
    data: { content: string; parentId?: string },
  ): Promise<RoomComment> {
    return this.request(`/home/rooms/${roomId}/threads/${threadId}/comments`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async voteRoomThread(
    roomId: string,
    threadId: string,
    value: number,
  ): Promise<{ threadId: string; score: number; userVote: number }> {
    return this.request(`/home/rooms/${roomId}/threads/${threadId}/vote`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
  }

  async voteRoomComment(
    roomId: string,
    threadId: string,
    commentId: string,
    value: number,
  ): Promise<{ commentId: string; score: number; userVote: number }> {
    return this.request(
      `/home/rooms/${roomId}/threads/${threadId}/comments/${commentId}/vote`,
      {
        method: "POST",
        body: JSON.stringify({ value }),
      },
    );
  }

  async deleteRoomThread(
    roomId: string,
    threadId: string,
  ): Promise<{ deleted: boolean }> {
    return this.request(`/home/rooms/${roomId}/threads/${threadId}`, {
      method: "DELETE",
    });
  }

  async updateRoomThread(
    roomId: string,
    threadId: string,
    data: { isLocked?: boolean; isPinned?: boolean },
  ): Promise<RoomThread> {
    return this.request(`/home/rooms/${roomId}/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteRoomComment(
    roomId: string,
    threadId: string,
    commentId: string,
  ): Promise<{ deleted: boolean }> {
    return this.request(
      `/home/rooms/${roomId}/threads/${threadId}/comments/${commentId}`,
      { method: "DELETE" },
    );
  }

  async editDirectMessage(
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<DirectMessage> {
    return this.request(`/dm/${conversationId}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
  }

  async deleteDirectMessage(
    conversationId: string,
    messageId: string,
  ): Promise<{ deleted: boolean }> {
    return this.request(`/dm/${conversationId}/messages/${messageId}`, {
      method: "DELETE",
    });
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

  // Home
  async getHome(userId: string): Promise<HomeData> {
    return this.request(`/home/${userId}`);
  }

  async createRoom(data: CreateRoomData): Promise<Room> {
    return this.request("/home/rooms", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getRoom(roomId: string): Promise<RoomWithThreads> {
    return this.request(`/home/rooms/${roomId}`);
  }

  async updateRoom(
    roomId: string,
    data: Partial<CreateRoomData>,
  ): Promise<Room> {
    return this.request(`/home/rooms/${roomId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.request(`/home/rooms/${roomId}`, { method: "DELETE" });
  }

  // sendRoomMessage removed — rooms now use threads

  async inviteToRoom(roomId: string, userId: string): Promise<RoomInvitation> {
    return this.request(`/home/rooms/${roomId}/invite`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  }

  async getInvitations(): Promise<RoomInvitationWithDetails[]> {
    return this.request("/home/invitations");
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    await this.request(`/home/invitations/${invitationId}/accept`, {
      method: "POST",
    });
  }

  async declineInvitation(invitationId: string): Promise<void> {
    await this.request(`/home/invitations/${invitationId}/decline`, {
      method: "POST",
    });
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    await this.request(`/home/rooms/${roomId}/members/${userId}`, {
      method: "DELETE",
    });
  }

  async addRoomMember(
    roomId: string,
    userId: string,
  ): Promise<{ userId: string; name: string }> {
    return this.request(`/home/rooms/${roomId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  }

  async removeRoomMember(roomId: string, memberId: string): Promise<void> {
    await this.request(`/home/rooms/${roomId}/members/${memberId}`, {
      method: "DELETE",
    });
  }

  // Map
  async getMapPoints(bounds: MapBounds): Promise<{ points: MapPoint[] }> {
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

  // Direct Messages
  async getConversations(): Promise<Conversation[]> {
    return this.request("/dm");
  }

  async getUnreadDmCount(): Promise<{ count: number }> {
    return this.request("/dm/unread-count");
  }

  async startConversation(userId: string): Promise<Conversation> {
    return this.request("/dm", {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  }

  async getConversation(
    id: string,
    limit?: number,
  ): Promise<ConversationWithMessages> {
    const query = limit ? `?limit=${limit}` : "";
    return this.request(`/dm/${id}${query}`);
  }

  async sendDirectMessage(
    conversationId: string,
    content: string,
  ): Promise<DirectMessage> {
    return this.request(`/dm/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  async markConversationRead(conversationId: string): Promise<void> {
    await this.request(`/dm/${conversationId}/read`, { method: "POST" });
  }

  // Notifications
  async getNotifications(limit?: number): Promise<AppNotification[]> {
    const query = limit ? `?limit=${limit}` : "";
    return this.request(`/notifications${query}`);
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

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Upload failed");
    }

    return data;
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

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Upload failed");
    }

    return data;
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

// Types
export interface User {
  id: string;
  email: string | null;
  name: string;
  verifiedName?: string;
  avatarUrl?: string;
  role: "citizen" | "institution" | "moderator";
  institutionType?: "municipality" | "agency" | "ministry";
  institutionName?: string;
  municipality?: Municipality;
  identityVerified: boolean;
  identityLevel: "basic" | "substantial" | "high";
  settings?: {
    notificationReplies: boolean;
    notificationMentions: boolean;
    notificationOfficial: boolean;
    locale: string;
  };
  onboardingCompletedAt?: string | null;
  hasPassword?: boolean;
  createdAt: string;
}

export interface Municipality {
  id: string;
  name: string;
  nameFi?: string;
  nameSv?: string;
  region?: string;
}

export interface Thread {
  id: string;
  title: string;
  content: string;
  contentHtml?: string;
  scope: "local" | "national" | "european";
  tags: string[];
  author: UserSummary;
  authorId?: string | null;
  municipality?: Municipality;
  institutionalContext?: InstitutionalContext;
  replyCount: number;
  score: number;
  userVote?: number;
  editedAt?: string | null;
  editedBy?: string | null;
  editorName?: string | null;
  createdAt: string;
  updatedAt: string;
  // AI/Import source tracking
  source?: "user" | "minutes_import" | "rss_import";
  sourceUrl?: string;
  sourceId?: string;
  aiGenerated?: boolean;
  sourceInstitutionId?: string;
  sourceInstitutionName?: string;
}

export interface ThreadWithComments extends Thread {
  isBookmarked?: boolean;
  viewCount?: number;
  comments: Comment[];
}

// Discovery types
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

export interface ExploreResponse extends PaginatedResponse<ExploreThread> {
  feedScope: "explore";
}

export interface TrendingItem {
  entityId: string;
  score: number;
  metadata: Record<string, unknown>;
  computedAt: string | null;
}

export interface TrendingResponse {
  type: "threads" | "tags";
  items: TrendingItem[];
  computedAt: string | null;
}

export interface AlgorithmDocumentation {
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

export type BookmarksResponse = PaginatedResponse<
  Thread & { isBookmarked: true; bookmarkedAt: string }
>;

export interface Comment {
  id: string;
  content: string;
  contentHtml?: string;
  author: UserSummary | null;
  authorId?: string | null;
  parentId?: string | null;
  score?: number;
  depth?: number;
  userVote?: number;
  editedAt?: string | null;
  editedBy?: string | null;
  isHidden?: boolean;
  createdAt: string;
}

export interface UserSummary {
  id: string | null;
  name: string;
  avatarUrl?: string;
  canViewProfile?: boolean;
  role: "citizen" | "institution" | "moderator";
  institutionType?: string;
  institutionName?: string;
  identityVerified?: boolean;
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
  description?: string;
  rules?: string[];
  category?: string;
  coverImageUrl?: string;
  isPublic: boolean;
  latitude?: string;
  longitude?: string;
  address?: string;
  municipalityId?: string;
  memberCount: number;
  creator: UserSummary;
  isMember: boolean;
  createdAt: string;
}

export interface ClubMember {
  id: string | null;
  name: string;
  avatarUrl?: string;
  canViewProfile?: boolean;
  role: string;
}

export interface ClubWithThreads extends Club {
  moderators: UserSummary[];
  members: ClubMember[];
  threads: ClubThread[];
  memberRole?: string;
}

export interface ClubInvitation {
  id: string;
  clubId?: string;
  status: string;
  createdAt: string;
  invitee?: {
    id: string;
    name: string;
    username: string;
    avatarUrl?: string;
  };
}

export interface ClubInvitationWithDetails {
  id: string;
  status: string;
  createdAt: string;
  club: {
    id: string;
    name: string;
    slug: string;
    coverImageUrl?: string;
    memberCount: number;
  };
  inviter: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
}

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

export interface ClubThreadWithComments extends ClubThread {
  memberRole?: string | null;
  comments: ClubComment[];
}

export type ClubComment = Comment;

// Home types
export interface Room {
  id: string;
  name: string;
  description?: string;
  visibility: "public" | "private";
  isPinned: boolean;
  threadCount: number;
  createdAt: string;
  updatedAt: string;
  canAccess?: boolean;
}

export interface RoomThread {
  id: string;
  roomId: string;
  title: string;
  content: string;
  contentHtml?: string;
  author: UserSummary | null;
  authorId?: string | null;
  editedAt?: string | null;
  editedBy?: string | null;
  isPinned: boolean;
  isLocked: boolean;
  replyCount: number;
  score: number;
  userVote: number;
  isHidden?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoomThreadWithComments extends RoomThread {
  isRoomOwner: boolean;
  comments: RoomComment[];
}

export interface RoomComment {
  id: string;
  threadId: string;
  parentId?: string | null;
  authorId: string;
  content: string;
  contentHtml?: string;
  author: UserSummary | null;
  score: number;
  userVote: number;
  isHidden?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface RoomWithThreads extends Room {
  owner: UserSummary;
  members: UserSummary[];
  threads: RoomThread[];
  isOwner: boolean;
  canPost: boolean;
}

export interface RoomInvitation {
  id: string;
  roomId: string;
  inviterId: string;
  inviteeId: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
}

export interface RoomInvitationWithDetails extends RoomInvitation {
  room: { id: string; name: string; description?: string };
  inviter: UserSummary;
}

export interface HomeData {
  owner: UserSummary;
  rooms: Room[];
  recentActivity: {
    threads: { id: string; title: string; scope: string; createdAt: string }[];
    clubs: { id: string; name: string; slug: string }[];
  };
  isOwnHome: boolean;
}

// Notification types
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

// Direct Message types
export interface Conversation {
  id: string;
  otherUser: UserSummary | null;
  lastMessage?: DirectMessage | null;
  unreadCount: number;
  updatedAt: string;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  content: string;
  contentHtml?: string;
  author: UserSummary | null;
  editedAt?: string | null;
  isHidden?: boolean;
  createdAt: string;
}

export interface EditHistoryEntry {
  id: string;
  contentType: string;
  previousContent: string;
  previousContentHtml?: string | null;
  previousTitle?: string | null;
  editedAt: string;
  editor: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
}

export interface ConversationWithMessages {
  id: string;
  otherUser: UserSummary | null;
  messages: DirectMessage[];
}

// Filter types - all scopes filter WITHIN subscriptions, never shows all content globally
export type FeedScope = "following" | "local" | "national" | "european" | "all";
export type SortBy = "recent" | "new" | "top";
export type TopPeriod = "day" | "week" | "month" | "year";

export interface ThreadFilters {
  scope?: "local" | "national" | "european";
  municipalityId?: string;
  tags?: string[];
  feedScope?: FeedScope;
  sortBy?: SortBy;
  topPeriod?: TopPeriod;
  page?: number;
  limit?: number;
}

export interface ThreadsResponse extends PaginatedResponse<Thread> {
  feedScope: FeedScope;
  hasSubscriptions?: boolean;
}

export interface ClubFilters {
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
  membership?: "mine";
}

// Create types
export interface CreateThreadData {
  title: string;
  content: string;
  scope: "local" | "national" | "european";
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

export interface CreateRoomData {
  name: string;
  description?: string;
  visibility?: "public" | "private";
}

// Map types
export interface MapPoint {
  id: string;
  type: "municipality" | "place" | "thread" | "club";
  name: string;
  latitude: number;
  longitude: number;
  meta: {
    threadCount?: number;
    memberCount?: number;
    category?: string;
    scope?: string;
    placeType?: string;
    language?: string;
    createdAt?: string;
  };
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
  latitude?: string;
  longitude?: string;
  radiusKm?: string;
  geojson?: unknown;
  type: "poi" | "area" | "route" | "landmark";
  category?: string;
  municipalityId?: string;
  municipality?: Municipality;
  createdAt: string;
}

export interface CreatePlaceData {
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

export interface LocationDetails {
  id: string;
  name: string;
  latitude?: string;
  longitude?: string;
  threads?: Thread[];
  clubs?: Club[];
  municipality?: Municipality;
  place?: Place;
}

// Dynamic Location types (Nominatim integration)
export type OsmType = "node" | "way" | "relation";
export type LocationStatus = "active" | "available";

export interface LocationResult {
  id: string | null; // DB ID (null if from Nominatim only)
  osmId: number;
  osmType: OsmType;
  name: string;
  nameFi: string | null;
  nameSv: string | null;
  nameEn: string | null;
  displayName: string;
  type: string; // 'municipality', 'village', 'region', etc.
  adminLevel: number | null;
  country: string;
  latitude: number;
  longitude: number;
  bounds: { south: number; north: number; west: number; east: number } | null;
  population: number | null;
  status: LocationStatus; // 'active' = in DB, 'available' = from Nominatim
  contentCount: number;
  parent: {
    name: string;
    type: string;
  } | null;
}

export interface LocationSearchResponse {
  results: LocationResult[];
  source: "cache" | "nominatim" | "mixed";
}

export interface LocationHierarchyItem {
  name: string;
  type: string;
  adminLevel: number | null;
}

export interface LocationWithHierarchy extends LocationResult {
  hierarchy: LocationHierarchyItem[];
}

// Subscription types
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

// Search types
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

export interface SearchTagResult {
  tag: string;
  count: number;
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
  contentCount: number;
  parentName?: string;
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

// Tag types
export interface TagWithCategory {
  tag: string;
  count: number;
  category: string | null;
  displayName: string | null;
  description: string | null;
  scope: string | null;
}

export interface TagPageResponse {
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

// Upload types
export interface UploadAvatarResponse {
  success: boolean;
  avatarUrl: string;
}

export interface UploadImageResponse {
  success: boolean;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

// ─── Admin types ──────────────────────────────────────────

export interface AdminDashboard {
  stats: {
    totalUsers: number;
    totalThreads: number;
    totalClubs: number;
    pendingReports: number;
    pendingAppeals: number;
  };
  recentReports: {
    id: string;
    contentType: string;
    reason: string;
    status: string;
    createdAt: string;
    reporterName: string;
  }[];
  recentActions: {
    id: string;
    actionType: string;
    targetType: string;
    reason: string;
    createdAt: string;
    adminName: string;
  }[];
}

export interface AdminUser {
  id: string;
  email: string | null;
  username: string;
  name: string;
  avatarUrl?: string;
  role: "citizen" | "institution" | "moderator";
  institutionType?: string;
  institutionName?: string;
  identityVerified: boolean;
  createdAt: string;
  lastSeenAt?: string;
}

export interface AdminSanction {
  id: string;
  sanctionType: "warning" | "suspension" | "ban";
  reason: string;
  issuedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  issuerName?: string;
}

export interface AdminUserDetail extends AdminUser {
  sanctions: AdminSanction[];
  threadCount: number;
  commentCount: number;
  inviteCodesRemaining: number;
}

export interface IssueSanctionData {
  sanctionType: "warning" | "suspension" | "ban";
  reason: string;
  expiresAt?: string;
}

export interface AdminReport {
  id: string;
  contentType: string;
  contentId: string;
  reason: string;
  description?: string;
  status: string;
  createdAt: string;
  resolvedAt?: string;
  reporterName: string;
  reporterUserId: string;
}

export interface AdminReportDetail extends AdminReport {
  content: AdminReportContentPreview | null;
  assignedTo?: string;
}

export interface AdminReportContentPreview {
  title?: string;
  content?: string;
  name?: string;
  authorId?: string;
  [key: string]: unknown;
}

export interface ModLogEntry {
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

export interface TransparencyStats {
  period: { from: string; to: string };
  reports: {
    byStatus: { status: string; count: number }[];
    byReason: { reason: string; count: number }[];
    byContentType: { contentType: string; count: number }[];
    avgResponseTimeHours: number | null;
  };
  actions: {
    byType: { actionType: string; count: number }[];
  };
  sanctions: {
    byType: { sanctionType: string; count: number }[];
  };
  appeals: {
    byStatus: { status: string; count: number }[];
  };
}

export interface AdminAppeal {
  id: string;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  adminResponse?: string;
  createdAt: string;
  respondedAt?: string;
  sanctionId?: string;
  reportId?: string;
  actionId?: string;
  userId: string;
  userName: string;
}

export interface SubmitReportData {
  contentType: string;
  contentId: string;
  reason: string;
  description?: string;
}

export interface ContentReportResponse {
  id: string;
  status: string;
  createdAt: string;
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

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  faviconUrl: string | null;
}

export interface SystemAnnouncement {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "critical";
  createdAt: string;
  expiresAt: string | null;
}

export interface AdminAnnouncement extends SystemAnnouncement {
  active: boolean;
  createdByName: string | null;
}

export interface GeneratedAdminInvite {
  id: string;
  code: string;
  createdAt: string;
}

export interface AdminInvite extends GeneratedAdminInvite {
  status: "available" | "used" | "revoked";
  usedAt: string | null;
  usedBy: { name: string } | null;
}

// Institution management types
export interface InstitutionManager {
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

export interface AvailableInstitution {
  id: string;
  name: string;
  institutionType: "municipality" | "agency" | "ministry";
  institutionName: string;
  municipalityId: string | null;
  identityProvider: string;
}

export interface InstitutionClaim {
  id: string;
  institutionId: string;
  userId: string;
  role: "owner" | "editor";
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface InstitutionClaimWithUser {
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
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface CreateOrganizationData {
  name: string;
  institutionName: string;
  businessId?: string;
  businessIdCountry?: string;
  websiteUrl?: string;
  description?: string;
  institutionType?: "organization" | "agency";
}

export interface CreatedOrganization {
  id: string;
  name: string;
  username: string;
  institutionType: string;
  institutionName: string;
  businessId: string | null;
}

export interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  status: "pending" | "approved" | "rejected";
  locale: string;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  emailSentAt: string | null;
  note: string | null;
}

export interface WaitlistStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

// Export singleton instance
export const api = new ApiClient(API_URL);
