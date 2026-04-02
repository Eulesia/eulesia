import { useState, useRef, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Lock,
  Globe,
  Send,
  Users,
  Settings,
  UserPlus,
  X,
  Trash2,
  Save,
  Search,
  MessageSquare,
  Pin,
  UserMinus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { ActorBadge } from "../components/common";
import {
  useRoom,
  useCreateRoomThread,
  useUpdateRoom,
  useDeleteRoom,
  useAddRoomMember,
  useRemoveRoomMember,
} from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import { formatRelativeTime } from "../lib/formatTime";
import { api } from "../lib/api";
import type { RoomThread, SearchUserResult, UserSummary } from "../lib/api";

function transformUser(user: UserSummary) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    verified: user.identityVerified ?? false,
    avatarUrl: user.avatarUrl,
    avatarInitials: user.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    institutionType: user.institutionType as
      | "municipality"
      | "agency"
      | "ministry"
      | undefined,
    institutionName: user.institutionName,
  };
}

export function RoomPage() {
  const { t } = useTranslation("home");
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { data: roomData, isLoading, error } = useRoom(roomId || "");
  const createThreadMutation = useCreateRoomThread(roomId || "");
  const updateRoomMutation = useUpdateRoom(roomId || "");
  const deleteRoomMutation = useDeleteRoom();
  const addRoomMemberMutation = useAddRoomMember(roomId || "");
  const removeRoomMemberMutation = useRemoveRoomMember(roomId || "");

  const [showNewThreadForm, setShowNewThreadForm] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [newThreadContent, setNewThreadContent] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteResults, setInviteResults] = useState<SearchUserResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<SearchUserResult | null>(
    null,
  );
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCreateThread = async () => {
    if (!newThreadTitle.trim() || !newThreadContent.trim()) return;
    try {
      await createThreadMutation.mutateAsync({
        title: newThreadTitle.trim(),
        content: newThreadContent.trim(),
      });
      setNewThreadTitle("");
      setNewThreadContent("");
      setShowNewThreadForm(false);
    } catch (err) {
      console.error("Failed to create thread:", err);
    }
  };

  const handleOpenSettings = () => {
    if (roomData) {
      setEditName(roomData.name);
      setEditDescription(roomData.description || "");
    }
    setShowSettings(true);
  };

  const handleSaveSettings = async () => {
    if (!editName.trim()) return;
    try {
      await updateRoomMutation.mutateAsync({
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      });
      setShowSettings(false);
    } catch (err) {
      console.error("Failed to update room:", err);
    }
  };

  const handleDeleteRoom = async () => {
    if (!roomId || !confirm(t("room.confirmDelete"))) return;
    try {
      await deleteRoomMutation.mutateAsync(roomId);
      navigate("/home");
    } catch (err) {
      console.error("Failed to delete room:", err);
    }
  };

  const handleInviteSearch = useCallback(
    (query: string) => {
      setInviteSearch(query);
      setSelectedUser(null);

      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

      if (query.trim().length < 2) {
        setInviteResults([]);
        return;
      }

      searchTimerRef.current = setTimeout(async () => {
        setIsSearching(true);
        try {
          const results = await api.searchUsers(query.trim(), 5);
          const memberIds = new Set([
            currentUser?.id,
            ...(roomData?.members.map((m) => m.id) || []),
            roomData?.owner.id,
          ]);
          setInviteResults(results.filter((u) => !memberIds.has(u.id)));
        } catch {
          setInviteResults([]);
        } finally {
          setIsSearching(false);
        }
      }, 300);
    },
    [currentUser?.id, roomData?.members, roomData?.owner.id],
  );

  const handleAddMember = async () => {
    if (!selectedUser) return;
    try {
      await addRoomMemberMutation.mutateAsync(selectedUser.id);
      setInviteSearch("");
      setInviteResults([]);
      setSelectedUser(null);
      setShowInvite(false);
    } catch (err) {
      console.error("Failed to add member:", err);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error || !roomData) {
    return (
      <Layout>
        <div className="px-4 py-12 text-center">
          <p className="text-red-600 mb-4">{t("room.loadError")}</p>
          <Link to="/home" className="text-teal-600 hover:underline">
            {t("room.backToHome")}
          </Link>
        </div>
      </Layout>
    );
  }

  const {
    owner,
    members,
    threads,
    isOwner,
    canPost,
    visibility,
    name,
    description,
  } = roomData;

  const pinnedThread = threads.find((t: RoomThread) => t.isPinned);
  const regularThreads = threads.filter((t: RoomThread) => !t.isPinned);

  return (
    <Layout>
      <SEOHead title={name} path={`/home/room/${roomId}`} noIndex />
      {/* Back navigation */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("room.backToHome")}
        </button>
      </div>

      {/* Room header */}
      <div
        className={`px-4 py-6 ${visibility === "public" ? "bg-green-50 dark:bg-green-900/20" : "bg-amber-50 dark:bg-amber-900/20"}`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              {visibility === "public" ? (
                <Globe className="w-4 h-4 text-green-600" />
              ) : (
                <Lock className="w-4 h-4 text-amber-600" />
              )}
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                {visibility === "public" ? t("room.public") : t("room.private")}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                &bull;
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("room.ownerHome", { name: owner.name })}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
              {name}
            </h1>
            {description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                {description}
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-2">
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{t("room.threadCount", { count: threads.length })}</span>
              </div>
              {visibility === "private" && (
                <div className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  <span>
                    {t("rooms.members", { count: members.length + 1 })}
                  </span>
                </div>
              )}
            </div>
          </div>
          {isOwner && (
            <div className="flex items-center gap-1 flex-shrink-0 ml-3">
              {visibility === "private" && (
                <button
                  onClick={() => setShowInvite(true)}
                  className="p-2 hover:bg-white/60 dark:hover:bg-gray-800/60 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  aria-label={t("room.inviteTitle")}
                >
                  <UserPlus className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={handleOpenSettings}
                className="p-2 hover:bg-white/60 dark:hover:bg-gray-800/60 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                aria-label={t("room.settings")}
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="px-4 py-6 space-y-6">
        {/* Pinned thread */}
        {pinnedThread && (
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 overflow-hidden">
            <div className="px-4 py-2 bg-amber-100 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 flex items-center gap-2 text-amber-800 dark:text-amber-300">
              <Pin className="w-4 h-4" />
              <span className="text-sm font-medium">
                {t("room.pinnedThread")}
              </span>
            </div>
            <Link
              to={`/home/room/${roomId}/thread/${pinnedThread.id}`}
              className="block p-4 hover:bg-amber-100/50 dark:hover:bg-amber-900/40 transition-colors"
            >
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                {pinnedThread.title}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                {pinnedThread.content.substring(0, 150)}
                {pinnedThread.content.length > 150 && "..."}
              </p>
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {t("room.replies", { count: pinnedThread.replyCount })}
                </span>
                <span>&middot;</span>
                <span>{formatRelativeTime(pinnedThread.updatedAt)}</span>
              </div>
            </Link>
          </div>
        )}

        {/* Threads */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("room.discussions")}
            </h2>
            {canPost && (
              <button
                onClick={() => setShowNewThreadForm(true)}
                className="text-sm text-teal-600 hover:text-teal-700 flex items-center gap-1"
              >
                <Send className="w-4 h-4" />
                {t("room.newThread")}
              </button>
            )}
          </div>

          {/* New thread form */}
          {showNewThreadForm && (
            <div className="mb-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {t("room.newThread")}
                </h3>
                <button
                  onClick={() => setShowNewThreadForm(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
              <input
                type="text"
                placeholder={t("room.threadTitlePlaceholder")}
                value={newThreadTitle}
                onChange={(e) => setNewThreadTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-gray-800 dark:text-gray-100"
              />
              <textarea
                placeholder={t("room.threadContentPlaceholder")}
                value={newThreadContent}
                onChange={(e) => setNewThreadContent(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg mb-3 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-gray-800 dark:text-gray-100"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowNewThreadForm(false)}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                >
                  {t("common:actions.cancel")}
                </button>
                <button
                  onClick={handleCreateThread}
                  disabled={
                    !newThreadTitle.trim() ||
                    !newThreadContent.trim() ||
                    createThreadMutation.isPending
                  }
                  className="inline-flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  {createThreadMutation.isPending
                    ? t("room.creating")
                    : t("room.createThread")}
                </button>
              </div>
            </div>
          )}

          {regularThreads.length > 0 ? (
            <div className="space-y-3">
              {regularThreads.map((thread: RoomThread) => (
                <Link
                  key={thread.id}
                  to={`/home/room/${roomId}/thread/${thread.id}`}
                  className="block bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 hover:shadow-md transition-shadow"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                    {thread.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                    {thread.content.substring(0, 150)}
                    {thread.content.length > 150 && "..."}
                  </p>
                  <div className="flex items-center justify-between">
                    {thread.author && (
                      <ActorBadge
                        user={transformUser(thread.author)}
                        size="sm"
                      />
                    )}
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      {(thread.score ?? 0) !== 0 && (
                        <span
                          className={`font-medium ${(thread.score ?? 0) > 0 ? "text-orange-600" : "text-blue-600"}`}
                        >
                          {(thread.score ?? 0) > 0 ? "+" : ""}
                          {thread.score}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" />
                        {thread.replyCount}
                      </span>
                      <span>{formatRelativeTime(thread.updatedAt)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            !showNewThreadForm && (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <p>{t("room.noThreads")}</p>
                <p className="text-sm mt-1">{t("room.noThreadsHint")}</p>
              </div>
            )
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="room-settings-title"
        >
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <h3
                id="room-settings-title"
                className="font-semibold text-gray-900 dark:text-gray-100"
              >
                {t("room.settings")}
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                aria-label={t("common:actions.close")}
              >
                <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("room.editName")}
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("room.editDescription")}
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 resize-none dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              {/* Members list */}
              {visibility === "private" && members.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t("room.members")}
                  </label>
                  <div className="border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                    {members.map((member, index) => (
                      <div
                        key={member.id ?? `${member.name}-${index}`}
                        className="flex items-center justify-between px-3 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {member.avatarUrl ? (
                            <img
                              src={member.avatarUrl}
                              alt={member.name}
                              className="w-7 h-7 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-600 dark:text-gray-400">
                              {member.name
                                .split(" ")
                                .map((n: string) => n[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()}
                            </div>
                          )}
                          <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                            {member.name}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            if (!member.id) return;
                            if (
                              confirm(
                                t("room.confirmRemoveMember", {
                                  name: member.name,
                                }),
                              )
                            ) {
                              removeRoomMemberMutation.mutate(member.id);
                            }
                          }}
                          disabled={
                            removeRoomMemberMutation.isPending || !member.id
                          }
                          className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
                          aria-label={t("room.removeMember")}
                          title={t("room.removeMember")}
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <button
                onClick={handleDeleteRoom}
                disabled={deleteRoomMutation.isPending}
                className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {t("room.deleteRoom")}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                >
                  {t("common:actions.cancel")}
                </button>
                <button
                  onClick={handleSaveSettings}
                  disabled={updateRoomMutation.isPending || !editName.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {updateRoomMutation.isPending
                    ? t("room.saving")
                    : t("common:actions.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showInvite && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="room-add-member-title"
        >
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <h3
                id="room-add-member-title"
                className="font-semibold text-gray-900 dark:text-gray-100"
              >
                {t("room.addMemberTitle")}
              </h3>
              <button
                onClick={() => {
                  setShowInvite(false);
                  setInviteSearch("");
                  setInviteResults([]);
                  setSelectedUser(null);
                }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                aria-label={t("common:actions.close")}
              >
                <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
            <div className="p-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("room.addMemberSearchLabel")}
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                <input
                  type="text"
                  value={inviteSearch}
                  onChange={(e) => handleInviteSearch(e.target.value)}
                  placeholder={t("room.invitePlaceholder")}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 dark:bg-gray-800 dark:text-gray-100"
                  autoFocus
                />
              </div>

              {inviteSearch.trim().length >= 2 && (
                <div className="mt-2 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                  {isSearching ? (
                    <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                      {t("room.inviteSearching")}
                    </div>
                  ) : inviteResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                      {t("room.inviteNoResults")}
                    </div>
                  ) : (
                    inviteResults.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => setSelectedUser(user)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                          selectedUser?.id === user.id
                            ? "bg-teal-50 dark:bg-teal-900/20 border-l-2 border-teal-600"
                            : ""
                        }`}
                      >
                        {user.avatarUrl ? (
                          <img
                            src={user.avatarUrl}
                            alt={user.name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium text-gray-600 dark:text-gray-400">
                            {user.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {user.name}
                          </p>
                          {user.institutionName && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {user.institutionName}
                            </p>
                          )}
                          {user.municipalityName && !user.institutionName && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {user.municipalityName}
                            </p>
                          )}
                        </div>
                        {selectedUser?.id === user.id && (
                          <div className="w-5 h-5 rounded-full bg-teal-600 flex items-center justify-center">
                            <svg
                              className="w-3 h-3 text-white"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowInvite(false);
                  setInviteSearch("");
                  setInviteResults([]);
                  setSelectedUser(null);
                }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                {t("common:actions.cancel")}
              </button>
              <button
                onClick={handleAddMember}
                disabled={addRoomMemberMutation.isPending || !selectedUser}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                <UserPlus className="w-4 h-4" />
                {addRoomMemberMutation.isPending
                  ? t("room.addingMember")
                  : t("room.addMember")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
