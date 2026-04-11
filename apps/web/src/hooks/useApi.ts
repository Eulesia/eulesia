import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { cacheSentDmPlaintext } from "../lib/e2ee/dmPlaintextCache.ts";
import { useAuth } from "./useAuth";
import type {
  ThreadFilters,
  ClubFilters,
  CreateThreadData,
  CreateCommentData,
  CreateClubData,
  CreateClubThreadData,
  EntityType,
  SubscribeData,
  OsmType,
  MapBounds,
} from "../lib/api";
import type { MapFilterState } from "../components/map/types";

export type CommentSort = "best" | "new" | "old" | "controversial";
type ConversationTargetDevice = { deviceId: string; userId: string };

// Query keys
export const queryKeys = {
  // Auth
  currentUser: ["currentUser"] as const,

  // Threads
  threads: (filters?: ThreadFilters) => ["threads", filters] as const,
  thread: (id: string, sort?: CommentSort) => ["thread", id, sort] as const,
  tags: ["tags"] as const,

  // Subscriptions
  subscriptions: ["subscriptions"] as const,
  subscriptionCheck: (entityType: EntityType, entityId: string) =>
    ["subscriptionCheck", entityType, entityId] as const,

  // Clubs
  clubs: (filters?: ClubFilters) => ["clubs", filters] as const,
  club: (id: string) => ["club", id] as const,
  clubThreads: (clubId: string) => ["clubThreads", clubId] as const,
  clubThread: (clubId: string, threadId: string) =>
    ["clubThread", clubId, threadId] as const,
  clubCategories: ["clubCategories"] as const,
  clubInvitations: (clubId: string) => ["clubInvitations", clubId] as const,
  myClubInvitations: ["myClubInvitations"] as const,

  // Direct Messages
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversation", id] as const,
  dmUnreadCount: ["dmUnreadCount"] as const,

  // Notifications
  notifications: ["notifications"] as const,
  notificationUnreadCount: ["notificationUnreadCount"] as const,

  // Map
  mapPoints: (bounds: MapBounds | null, filters: MapFilterState) =>
    ["mapPoints", bounds, filters] as const,
  mapLocation: (type: string, id: string) => ["mapLocation", type, id] as const,

  // Link previews
  linkPreview: (url: string) => ["linkPreview", url] as const,

  // System announcements
  announcements: ["announcements"] as const,

  // Institutions
  myInstitutions: ["myInstitutions"] as const,
  availableInstitutions: ["availableInstitutions"] as const,
  institutionClaims: ["institutionClaims"] as const,
};

export async function loadConversationTargetDevices(
  userIds: string[],
  currentUserId: string,
  client: Pick<typeof api, "getUserDevices" | "listDevices"> = api,
): Promise<ConversationTargetDevice[]> {
  const uniqueUserIds = [...new Set(userIds)];
  const deviceLists = await Promise.all(
    uniqueUserIds.map(async (userId) => {
      const devices =
        userId === currentUserId
          ? await client.listDevices()
          : await client.getUserDevices(userId);

      return devices.map((device) => ({
        deviceId: device.id,
        userId,
      }));
    }),
  );

  const seenDeviceIds = new Set<string>();
  return deviceLists.flatMap((devices) =>
    devices.filter(({ deviceId }) => {
      if (seenDeviceIds.has(deviceId)) {
        return false;
      }
      seenDeviceIds.add(deviceId);
      return true;
    }),
  );
}

// Auth hooks
export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: () => api.getCurrentUser(),
    retry: false,
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

export function useRequestMagicLink() {
  return useMutation({
    mutationFn: (email: string) => api.requestMagicLink(email),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

// Thread hooks
export function useThreads(filters?: ThreadFilters) {
  return useQuery({
    queryKey: queryKeys.threads(filters),
    queryFn: () => api.getThreads(filters),
  });
}

export function useThread(id: string, sort: CommentSort = "best") {
  return useQuery({
    queryKey: queryKeys.thread(id, sort),
    queryFn: () => api.getThread(id, sort),
    enabled: !!id,
  });
}

export function useTags() {
  return useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => api.getTags(),
  });
}

export function useTagPage(tag: string, page = 1) {
  return useQuery({
    queryKey: ["tagPage", tag, page] as const,
    queryFn: () => api.getTagPage(tag, page),
    enabled: !!tag,
  });
}

export function useCreateThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateThreadData) => api.createThread(data),
    onSuccess: () => {
      // Invalidate all thread queries to refresh feeds
      queryClient.invalidateQueries({
        queryKey: ["threads"],
        refetchType: "all",
      });
    },
  });
}

export function useAddComment(threadId: string, sort?: CommentSort) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCommentData) => api.addComment(threadId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.thread(threadId, sort),
      });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useVoteComment(threadId: string, sort?: CommentSort) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ commentId, value }: { commentId: string; value: number }) =>
      api.voteComment(commentId, value),
    onSuccess: (data) => {
      // Update the thread cache with new score
      queryClient.setQueryData(queryKeys.thread(threadId, sort), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          comments: old.comments.map((c: any) =>
            c.id === data.commentId
              ? { ...c, score: data.score, userVote: data.userVote }
              : c,
          ),
        };
      });
    },
  });
}

export function useVoteThread(filters?: ThreadFilters) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ threadId, value }: { threadId: string; value: number }) =>
      api.voteThread(threadId, value),
    onSuccess: (data) => {
      // Update the threads list cache
      queryClient.setQueryData(queryKeys.threads(filters), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((t: any) =>
            t.id === data.threadId
              ? { ...t, score: data.score, userVote: data.userVote }
              : t,
          ),
        };
      });
      // Also update individual thread cache if it exists (matches any sort)
      queryClient.setQueriesData(
        { queryKey: ["thread", data.threadId], exact: false },
        (old: any) => {
          if (!old) return old;
          return { ...old, score: data.score, userVote: data.userVote };
        },
      );
    },
  });
}

// Edit/Delete hooks — Agora
export function useEditThread(threadId: string, sort?: CommentSort) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { title?: string; content: string }) =>
      api.editThread(threadId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.thread(threadId, sort),
      });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (threadId: string) => api.deleteThread(threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useThreadEditHistory(threadId: string) {
  return useQuery({
    queryKey: ["threadEditHistory", threadId] as const,
    queryFn: () => api.getThreadEditHistory(threadId),
    enabled: !!threadId,
  });
}

export function useEditComment(threadId: string, sort?: CommentSort) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      commentId,
      content,
    }: {
      commentId: string;
      content: string;
    }) => api.editComment(commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.thread(threadId, sort),
      });
    },
  });
}

export function useDeleteComment(threadId: string, sort?: CommentSort) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) => api.deleteComment(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.thread(threadId, sort),
      });
    },
  });
}

// Edit/Delete hooks — Direct messages
export function useEditDirectMessage(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      content,
    }: {
      messageId: string;
      content: string;
    }) => api.editDirectMessage(conversationId, messageId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(conversationId),
      });
    },
  });
}

export function useDeleteDirectMessage(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) =>
      api.deleteDirectMessage(conversationId, messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(conversationId),
      });
    },
  });
}

// Subscription hooks
export function useSubscriptions() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.subscriptions,
    queryFn: () => api.getSubscriptions(),
    enabled: isAuthenticated,
  });
}

export function useSubscriptionCheck(entityType: EntityType, entityId: string) {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.subscriptionCheck(entityType, entityId),
    queryFn: () => api.checkSubscription(entityType, entityId),
    enabled: isAuthenticated && !!entityId,
  });
}

export function useSubscribe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SubscribeData) => api.subscribe(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
      queryClient.invalidateQueries({
        queryKey: queryKeys.subscriptionCheck(
          variables.entityType,
          variables.entityId,
        ),
      });
      // Invalidate threads with following feed scope
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useUnsubscribe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      entityType,
      entityId,
    }: {
      entityType: EntityType;
      entityId: string;
    }) => api.unsubscribe(entityType, entityId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
      queryClient.invalidateQueries({
        queryKey: queryKeys.subscriptionCheck(
          variables.entityType,
          variables.entityId,
        ),
      });
      // Invalidate threads with following feed scope
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

// Onboarding hook
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.completeOnboarding(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    },
  });
}

// Club hooks
export function useClubs(filters?: ClubFilters) {
  return useQuery({
    queryKey: queryKeys.clubs(filters),
    queryFn: () => api.getClubs(filters),
  });
}

export function useClub(id: string) {
  return useQuery({
    queryKey: queryKeys.club(id),
    queryFn: () => api.getClub(id),
    enabled: !!id,
  });
}

export function useClubThreads(clubId: string) {
  return useQuery({
    queryKey: queryKeys.clubThreads(clubId),
    queryFn: () => api.listClubThreads(clubId),
    enabled: !!clubId,
  });
}

export function useClubCategories() {
  return useQuery({
    queryKey: queryKeys.clubCategories,
    queryFn: () => api.getClubCategories(),
  });
}

export function useCreateClub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateClubData) => api.createClub(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useUpdateClub(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<CreateClubData>) => api.updateClub(clubId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.club(clubId) });
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useDeleteClub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (clubId: string) => api.deleteClub(clubId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

// Club invitation hooks
export function useClubInvitations(clubId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.clubInvitations(clubId),
    queryFn: () => api.getClubInvitations(clubId),
    enabled: enabled && !!clubId,
  });
}

export function useMyClubInvitations() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.myClubInvitations,
    queryFn: () => api.getMyClubInvitations(),
    enabled: isAuthenticated,
  });
}

export function useInviteToClub(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => api.inviteToClub(clubId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clubInvitations(clubId),
      });
    },
  });
}

export function useAcceptClubInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invitationId: string) =>
      api.acceptClubInvitation(invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myClubInvitations });
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useDeclineClubInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invitationId: string) =>
      api.declineClubInvitation(invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myClubInvitations });
    },
  });
}

export function useCancelClubInvitation(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invitationId: string) =>
      api.cancelClubInvitation(clubId, invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clubInvitations(clubId),
      });
    },
  });
}

export function useJoinClub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (clubId: string) => api.joinClub(clubId),
    onSuccess: (_, clubId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.club(clubId) });
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useLeaveClub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (clubId: string) => api.leaveClub(clubId),
    onSuccess: (_, clubId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.club(clubId) });
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useClubThread(clubId: string, threadId: string) {
  return useQuery({
    queryKey: queryKeys.clubThread(clubId, threadId),
    queryFn: () => api.getClubThread(clubId, threadId),
    enabled: !!clubId && !!threadId,
  });
}

export function useCreateClubThread(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateClubThreadData) =>
      api.createClubThread(clubId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.club(clubId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.clubThreads(clubId),
      });
    },
  });
}

export function useAddClubComment(clubId: string, threadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCommentData) =>
      api.addClubComment(clubId, threadId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clubThread(clubId, threadId),
      });
    },
  });
}

// Club moderation hooks
export function useUpdateMemberRole(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.updateMemberRole(clubId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.club(clubId) });
    },
  });
}

export function useRemoveMember(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => api.removeMember(clubId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.club(clubId) });
    },
  });
}

export function useDeleteClubThread(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (threadId: string) => api.deleteClubThread(clubId, threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.club(clubId) });
    },
  });
}

export function useUpdateClubThread(clubId: string, threadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { isLocked?: boolean; isPinned?: boolean }) =>
      api.updateClubThread(clubId, threadId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clubThread(clubId, threadId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.club(clubId) });
    },
  });
}

export function useDeleteClubComment(clubId: string, threadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) =>
      api.deleteClubComment(clubId, threadId, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clubThread(clubId, threadId),
      });
    },
  });
}

export function useVoteClubThread(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ threadId, value }: { threadId: string; value: number }) =>
      api.voteClubThread(clubId, threadId, value),
    onSuccess: (data) => {
      // Update club cache (thread list)
      queryClient.setQueryData(queryKeys.club(clubId), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          threads: old.threads.map((t: any) =>
            t.id === data.threadId
              ? { ...t, score: data.score, userVote: data.userVote }
              : t,
          ),
        };
      });
      // Update individual thread cache
      queryClient.setQueriesData(
        { queryKey: queryKeys.clubThread(clubId, data.threadId), exact: false },
        (old: any) => {
          if (!old) return old;
          return { ...old, score: data.score, userVote: data.userVote };
        },
      );
    },
  });
}

export function useVoteClubComment(clubId: string, threadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ commentId, value }: { commentId: string; value: number }) =>
      api.voteClubComment(clubId, threadId, commentId, value),
    onSuccess: (data) => {
      queryClient.setQueryData(
        queryKeys.clubThread(clubId, threadId),
        (old: any) => {
          if (!old) return old;
          return {
            ...old,
            comments: old.comments.map((c: any) =>
              c.id === data.commentId
                ? { ...c, score: data.score, userVote: data.userVote }
                : c,
            ),
          };
        },
      );
    },
  });
}

// DM hooks
export function useConversations() {
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: () => api.getConversations(),
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: queryKeys.conversation(id),
    queryFn: () => api.getConversation(id),
    enabled: !!id,
  });
}

export function useStartConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => api.startConversation(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useSendDM(
  conversationId: string,
  options?: {
    /** The conversation encryption mode. */
    encryption?: "e2ee" | "none";
    /** The local device ID, if E2EE is initialized. */
    deviceId?: string | null;
    /** The current authenticated user ID. */
    userId?: string | null;
    /** The ID of the other user in the conversation, for device lookup. */
    otherUserId?: string | null;
  },
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (content: string) => {
      const {
        encryption = "e2ee",
        deviceId,
        userId,
        otherUserId,
      } = options ?? {};

      if (encryption !== "e2ee") {
        return api.sendDirectMessage(conversationId, { content });
      }

      if (!deviceId) {
        throw new Error("DEVICE_NOT_INITIALIZED");
      }

      if (!userId) {
        throw new Error("USER_ID_UNKNOWN");
      }

      if (!otherUserId) {
        throw new Error("RECIPIENT_UNKNOWN");
      }

      const targetDevices = await loadConversationTargetDevices(
        [userId, otherUserId],
        userId,
      );
      if (!targetDevices.some((target) => target.userId === otherUserId)) {
        throw new Error("RECIPIENT_NO_DEVICE");
      }
      if (!targetDevices.some((target) => target.deviceId === deviceId)) {
        throw new Error("SENDER_DEVICE_MISSING");
      }

      const { encryptForConversation } = await import("../lib/e2ee/index.ts");

      const payload = await encryptForConversation(
        conversationId,
        targetDevices,
        content,
        api,
      );

      return api.sendEncryptedDirectMessage(conversationId, {
        deviceCiphertexts: payload.deviceCiphertexts,
        senderDeviceId: deviceId,
      });
    },
    onSuccess: (message, content) => {
      const cachedDeviceId = options?.deviceId;
      const cachedUserId = options?.userId;
      if (
        (options?.encryption ?? "e2ee") === "e2ee" &&
        cachedDeviceId &&
        cachedUserId
      ) {
        cacheSentDmPlaintext({
          messageId: message.id,
          content,
          deviceId: cachedDeviceId,
          senderId: cachedUserId,
        });
      }

      queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(conversationId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      queryClient.invalidateQueries({ queryKey: queryKeys.dmUnreadCount });
    },
  });
}

export function useMarkRead(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.markConversationRead(conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      queryClient.invalidateQueries({ queryKey: queryKeys.dmUnreadCount });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationUnreadCount,
      });
    },
  });
}

export function useUnreadDmCount() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.dmUnreadCount,
    queryFn: () => api.getUnreadDmCount(),
    refetchInterval: 30_000,
    enabled: isAuthenticated,
  });
}

// Group conversation hooks
export function useGroupConversation(id: string) {
  return useQuery({
    queryKey: ["groupConversation", id] as const,
    queryFn: () => api.getGroupConversation(id),
    enabled: !!id,
  });
}

export function useDeleteGroupMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api.deleteDirectMessage(conversationId, messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["groupConversation", conversationId],
      });
    },
  });
}

export function useGroupMembers(conversationId: string) {
  return useQuery({
    queryKey: ["groupMembers", conversationId] as const,
    queryFn: () => api.getGroupMembers(conversationId),
    enabled: !!conversationId,
  });
}

export function useCreateGroupConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      members: string[];
    }) => api.createGroupConversation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useInviteGroupMember(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.inviteGroupMember(conversationId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["groupMembers", conversationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["groupConversation", conversationId],
      });
    },
  });
}

export function useRemoveGroupMember(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.removeGroupMember(conversationId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["groupMembers", conversationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["groupConversation", conversationId],
      });
    },
  });
}

export function useSendGroupMessage(
  conversationId: string,
  options?: {
    deviceId?: string | null;
    userId?: string | null;
  },
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const { deviceId, userId } = options ?? {};
      if (!deviceId) throw new Error("DEVICE_NOT_INITIALIZED");
      if (!userId) throw new Error("USER_ID_UNKNOWN");

      const latestState = await api.getGroupConversationState(conversationId);
      const memberUserIds = latestState.members.map((member) => member.userId);
      if (!memberUserIds.length) {
        throw new Error("GROUP_MEMBERS_UNKNOWN");
      }

      const { encryptForGroup } = await import("../lib/e2ee/index.ts");
      const ciphertext = await encryptForGroup(
        conversationId,
        content,
        latestState.currentEpoch,
        memberUserIds,
        api,
      );

      return api.sendGroupMessage(conversationId, {
        ciphertext,
        senderDeviceId: deviceId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["groupConversation", conversationId],
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

// Notification hooks
export function useNotifications() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.getNotifications(30),
    enabled: isAuthenticated,
  });
}

export function useUnreadNotificationCount() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.notificationUnreadCount,
    queryFn: () => api.getUnreadNotificationCount(),
    refetchInterval: 60_000,
    enabled: isAuthenticated,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationUnreadCount,
      });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationUnreadCount,
      });
    },
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteNotification(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationUnreadCount,
      });
    },
  });
}

// Municipality hooks
export function useMunicipalities() {
  return useQuery({
    queryKey: ["municipalities"],
    queryFn: () => api.getMunicipalities(),
  });
}

// Location hooks (dynamic with Nominatim)
export function useLocationSearch(
  query: string,
  options?: {
    country?: string;
    types?: string[];
    limit?: number;
    includeNominatim?: boolean;
  },
) {
  return useQuery({
    queryKey: ["locationSearch", query, options],
    queryFn: () => api.searchLocations(query, options),
    enabled: query.length >= 2, // Only search with 2+ characters
    staleTime: 1000 * 60 * 30, // 30 minutes - locations rarely change
  });
}

export function useLocation(id: string) {
  return useQuery({
    queryKey: ["location", id],
    queryFn: () => api.getLocation(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useLocationByOsm(
  osmType: OsmType | null,
  osmId: number | null,
) {
  return useQuery({
    queryKey: ["locationOsm", osmType, osmId],
    queryFn: () => api.getLocationByOsm(osmType!, osmId!),
    enabled: !!osmType && !!osmId,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

// User hooks
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Parameters<typeof api.updateProfile>[0]) =>
      api.updateProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.currentUser });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (data: Parameters<typeof api.changePassword>[0]) =>
      api.changePassword(data),
  });
}

export function useExportData() {
  return useMutation({
    mutationFn: () => api.exportData(),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => api.deleteAccount(),
  });
}

// Search hooks
export function useSearch(query: string, limit = 5) {
  return useQuery({
    queryKey: ["search", query, limit],
    queryFn: () => api.search(query, limit),
    enabled: query.length >= 2, // Only search with 2+ characters
    staleTime: 1000 * 60, // 1 minute
  });
}

export function useSearchUsers(query: string, limit = 10) {
  return useQuery({
    queryKey: ["searchUsers", query, limit],
    queryFn: () => api.searchUsers(query, limit),
    enabled: query.length >= 2,
    staleTime: 1000 * 60,
  });
}

export function useSearchThreads(
  query: string,
  options?: Parameters<typeof api.searchThreads>[1],
) {
  return useQuery({
    queryKey: ["searchThreads", query, options],
    queryFn: () => api.searchThreads(query, options),
    enabled: query.length >= 2,
    staleTime: 1000 * 60,
  });
}

export function useSearchPlaces(query: string, limit = 10) {
  return useQuery({
    queryKey: ["searchPlaces", query, limit],
    queryFn: () => api.searchPlaces(query, limit),
    enabled: query.length >= 2,
    staleTime: 1000 * 60,
  });
}

// Map hooks
// Map filter type names → backend MapPointType values
const FILTER_TO_POINT_TYPE: Record<string, string> = {
  municipalities: "municipality",
  agora: "thread",
  clubs: "club",
  places: "place",
};

function filtersToParams(filters: MapFilterState): Partial<MapBounds> {
  return {
    types: filters.types.map((t) => FILTER_TO_POINT_TYPE[t] || t).join(","),
    timePreset: filters.timePreset,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    scope: filters.scopes?.join(","),
    language: filters.languages?.join(","),
    tags: filters.tags?.join(","),
  };
}

export function useMapPoints(
  bounds: MapBounds | null,
  filters: MapFilterState,
) {
  return useQuery({
    queryKey: queryKeys.mapPoints(bounds, filters),
    queryFn: () =>
      api.getMapPoints({ ...bounds!, ...filtersToParams(filters) }),
    enabled: !!bounds,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useMapLocationDetails(type: string, id: string) {
  return useQuery({
    queryKey: queryKeys.mapLocation(type, id),
    queryFn: () => api.getLocationDetails(type, id),
    enabled: !!type && !!id,
    staleTime: 5 * 60_000,
  });
}

// Link previews
export function useLinkPreview(url: string) {
  return useQuery({
    queryKey: queryKeys.linkPreview(url),
    queryFn: () => api.getLinkPreview(url),
    enabled: !!url,
    staleTime: 24 * 60 * 60_000, // 24h
    retry: false,
  });
}

// System announcements
export function useAnnouncements() {
  return useQuery({
    queryKey: queryKeys.announcements,
    queryFn: () => api.getAnnouncements(),
    staleTime: 60_000, // 1 min
    refetchInterval: 5 * 60_000, // poll every 5 min
  });
}

// Institution management hooks
export function useMyInstitutions() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.myInstitutions,
    queryFn: () => api.getMyInstitutions(),
    enabled: isAuthenticated,
  });
}

export function useAvailableInstitutions() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.availableInstitutions,
    queryFn: () => api.getAvailableInstitutions(),
    enabled: isAuthenticated,
  });
}

export function useClaimInstitution() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      institutionId,
      role,
    }: {
      institutionId: string;
      role?: "owner" | "editor";
    }) => api.claimInstitution(institutionId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myInstitutions });
      queryClient.invalidateQueries({
        queryKey: queryKeys.availableInstitutions,
      });
    },
  });
}

export function useInstitutionClaims() {
  return useQuery({
    queryKey: queryKeys.institutionClaims,
    queryFn: () => api.getInstitutionClaims(),
  });
}

export function useUpdateInstitutionClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      claimId,
      status,
    }: {
      claimId: string;
      status: "approved" | "rejected";
    }) => api.updateInstitutionClaim(claimId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.institutionClaims });
    },
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Parameters<typeof api.createOrganization>[0]) =>
      api.createOrganization(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myInstitutions });
    },
  });
}
