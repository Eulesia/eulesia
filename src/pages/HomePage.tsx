import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Home,
  Plus,
  Lock,
  Globe,
  MessageSquare,
  Users,
  Settings,
  ChevronRight,
  BookOpen,
  Activity,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { ContentEndMarker } from "../components/common";
import {
  useHome,
  useCreateRoom,
  useInvitations,
  useAcceptInvitation,
  useDeclineInvitation,
} from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import { useGuide } from "../hooks/useGuide";
import type { Room, RoomInvitationWithDetails } from "../lib/api";

export function HomePage() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { data: homeData, isLoading, error } = useHome(currentUser?.id || "");
  const { data: invitations } = useInvitations();
  const createRoomMutation = useCreateRoom();
  const acceptInvitationMutation = useAcceptInvitation();
  const declineInvitationMutation = useDeclineInvitation();
  const { hasCompletedGuide, startGuide, isGuideActive } = useGuide();
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomDescription, setNewRoomDescription] = useState("");
  const [newRoomVisibility, setNewRoomVisibility] = useState<
    "public" | "private"
  >("public");

  // Auto-trigger home guide on first visit
  useEffect(() => {
    if (!currentUser) return;

    const timer = setTimeout(() => {
      if (!hasCompletedGuide("home") && !isGuideActive) {
        startGuide("home");
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [currentUser, hasCompletedGuide, isGuideActive, startGuide]);

  if (!currentUser) {
    return (
      <Layout>
        <div className="px-4 py-12 text-center">
          <Home className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            {t("welcome")}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t("signInPrompt")}
          </p>
          <Link to="/login" className="text-blue-600 hover:underline">
            {t("signIn")}
          </Link>
        </div>
      </Layout>
    );
  }

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;

    try {
      const room = await createRoomMutation.mutateAsync({
        name: newRoomName.trim(),
        description: newRoomDescription.trim() || undefined,
        visibility: newRoomVisibility,
      });
      setNewRoomName("");
      setNewRoomDescription("");
      setNewRoomVisibility("public");
      setShowCreateRoom(false);
      // Navigate to the new room so user can invite people
      navigate(`/home/room/${room.id}`);
    } catch (err) {
      console.error("Failed to create room:", err);
    }
  };

  const publicRooms =
    homeData?.rooms.filter((r: Room) => r.visibility === "public") || [];
  const privateRooms =
    homeData?.rooms.filter((r: Room) => r.visibility === "private") || [];
  const pendingInvitations = invitations || [];

  return (
    <Layout>
      <SEOHead
        title={t("greeting", { name: currentUser?.name })}
        description={t("subtitle")}
        path="/home"
        noIndex
      />
      {/* Header */}
      <div
        className="bg-gradient-to-r from-teal-700 to-teal-600 px-4 py-5"
        data-guide="home-header"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Home className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                {t("greeting", { name: currentUser.name })}
              </h1>
              <p className="text-sm text-teal-100">{t("subtitle")}</p>
            </div>
          </div>
          <Link
            to="/profile"
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <Settings className="w-5 h-5 text-white" />
          </Link>
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {/* Pending Invitations */}
        {pendingInvitations.length > 0 && (
          <div
            className="bg-amber-50 border border-amber-200 rounded-xl p-4"
            data-guide="home-invitations"
          >
            <h2 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" />
              {t("pendingInvites")} ({pendingInvitations.length})
            </h2>
            <div className="space-y-2">
              {pendingInvitations.map((inv: RoomInvitationWithDetails) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between bg-white dark:bg-gray-900 p-3 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {inv.room.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t("fromUser", { name: inv.inviter.name })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => acceptInvitationMutation.mutate(inv.id)}
                      disabled={acceptInvitationMutation.isPending}
                      className="text-xs bg-teal-600 text-white px-3 py-1 rounded-full hover:bg-teal-700 disabled:opacity-50"
                    >
                      {acceptInvitationMutation.isPending ? "..." : t("accept")}
                    </button>
                    <button
                      onClick={() => declineInvitationMutation.mutate(inv.id)}
                      disabled={declineInvitationMutation.isPending}
                      className="text-xs text-gray-600 dark:text-gray-400 px-3 py-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                    >
                      {declineInvitationMutation.isPending
                        ? "..."
                        : t("decline")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-center py-12 text-red-600">
            <p>{t("loadError")}</p>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* Rooms Section */}
            <div data-guide="home-rooms">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  {t("rooms.title")}
                </h2>
                <button
                  onClick={() => setShowCreateRoom(true)}
                  className="text-sm text-teal-600 hover:text-teal-700 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  {t("rooms.create")}
                </button>
              </div>

              {/* Create Room Form */}
              {showCreateRoom && (
                <form
                  onSubmit={handleCreateRoom}
                  className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4"
                >
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">
                    {t("rooms.createTitle")}
                  </h3>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      placeholder={t("rooms.namePlaceholder")}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                      required
                    />
                    <textarea
                      value={newRoomDescription}
                      onChange={(e) => setNewRoomDescription(e.target.value)}
                      placeholder={t("rooms.description")}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                      rows={2}
                    />
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="visibility"
                          checked={newRoomVisibility === "public"}
                          onChange={() => setNewRoomVisibility("public")}
                          className="text-teal-600"
                        />
                        <Globe className="w-4 h-4 text-green-600" />
                        <span className="text-sm">{t("rooms.openToAll")}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="visibility"
                          checked={newRoomVisibility === "private"}
                          onChange={() => setNewRoomVisibility("private")}
                          className="text-teal-600"
                        />
                        <Lock className="w-4 h-4 text-amber-600" />
                        <span className="text-sm">{t("rooms.inviteOnly")}</span>
                      </label>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        type="submit"
                        disabled={createRoomMutation.isPending}
                        className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50"
                      >
                        {createRoomMutation.isPending
                          ? t("rooms.creating")
                          : t("rooms.createButton")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCreateRoom(false)}
                        className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                      >
                        {t("common:actions.cancel")}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Public Rooms */}
              {publicRooms.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium flex items-center gap-1">
                    <Globe className="w-3 h-3" /> {t("rooms.public")}
                  </p>
                  {publicRooms.map((room: Room) => (
                    <RoomCard key={room.id} room={room} />
                  ))}
                </div>
              )}

              {/* Private Rooms */}
              {privateRooms.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium flex items-center gap-1">
                    <Lock className="w-3 h-3" /> {t("rooms.private")}
                  </p>
                  {privateRooms.map((room: Room) => (
                    <RoomCard key={room.id} room={room} />
                  ))}
                </div>
              )}

              {publicRooms.length === 0 && privateRooms.length === 0 && (
                <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                  <MessageSquare className="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
                  <p className="text-gray-600 dark:text-gray-400 mb-1">
                    {t("rooms.noRooms")}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("rooms.noRoomsHint")}
                  </p>
                </div>
              )}
            </div>

            {/* Recent Activity */}
            <div data-guide="home-activity">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                {t("recentActivity")}
              </h2>

              {homeData?.recentActivity?.threads &&
                homeData.recentActivity.threads.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t("agoraDiscussions")}
                    </p>
                    {homeData.recentActivity.threads
                      .slice(0, 3)
                      .map(
                        (thread: {
                          id: string;
                          title: string;
                          scope: string;
                        }) => (
                          <Link
                            key={thread.id}
                            to={`/agora/thread/${thread.id}`}
                            className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:shadow-sm transition-shadow"
                          >
                            <BookOpen className="w-4 h-4 text-blue-600" />
                            <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 truncate">
                              {thread.title}
                            </span>
                            <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                          </Link>
                        ),
                      )}
                  </div>
                )}

              {homeData?.recentActivity?.clubs &&
                homeData.recentActivity.clubs.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t("clubs")}
                    </p>
                    {homeData.recentActivity.clubs
                      .slice(0, 3)
                      .map(
                        (club: { id: string; name: string; slug: string }) => (
                          <Link
                            key={club.id}
                            to={`/clubs/${club.id}`}
                            className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:shadow-sm transition-shadow"
                          >
                            <Users className="w-4 h-4 text-violet-600" />
                            <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 truncate">
                              {club.name}
                            </span>
                            <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                          </Link>
                        ),
                      )}
                  </div>
                )}
            </div>

            <ContentEndMarker />
          </>
        )}
      </div>
    </Layout>
  );
}

function RoomCard({ room }: { room: Room }) {
  const { t } = useTranslation("home");

  return (
    <Link
      to={`/home/room/${room.id}`}
      className="flex items-center justify-between p-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            room.visibility === "public" ? "bg-green-100" : "bg-amber-100"
          }`}
        >
          {room.visibility === "public" ? (
            <Globe className="w-5 h-5 text-green-600" />
          ) : (
            <Lock className="w-5 h-5 text-amber-600" />
          )}
        </div>
        <div>
          <h3 className="font-medium text-gray-900 dark:text-gray-100">
            {room.name}
          </h3>
          {room.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
              {room.description}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {room.threadCount > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("rooms.threads", { count: room.threadCount })}
          </span>
        )}
        <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500" />
      </div>
    </Link>
  );
}
