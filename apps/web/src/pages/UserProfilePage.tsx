import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Shield,
  Building2,
  Calendar,
  MessageSquare,
  Hash,
  Bot,
  Users,
  Send,
  Home,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { FollowButton, ReportButton } from "../components/common";
import { useAuth } from "../hooks/useAuth";
import { useStartConversation } from "../hooks/useApi";
import { formatDateLong } from "../lib/formatTime";
import { buildApiUrl } from "../lib/runtimeConfig";

interface UserThread {
  id: string;
  title: string;
  content: string;
  scope: "municipal" | "regional" | "national";
  replyCount: number;
  score: number;
  createdAt: string;
  municipalityId?: string;
  municipalityName?: string;
  tags: string[];
}

interface InstitutionTopic {
  institutionId: string;
  topicTag: string;
  relatedTags: string[];
  description: string | null;
}

interface UserProfile {
  id: string;
  name: string;
  verifiedName?: string;
  avatarUrl?: string;
  role: "citizen" | "institution" | "moderator";
  institutionType?: string;
  institutionName?: string;
  identityVerified: boolean;
  createdAt: string;
  threads: UserThread[];
  // Institution-specific
  institutionTopic?: InstitutionTopic | null;
  botSummaries?: UserThread[];
  citizenDiscussions?: UserThread[];
}

function getAvatarInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ThreadListItem({ thread }: { thread: UserThread }) {
  return (
    <Link
      key={thread.id}
      to={`/agora/thread/${thread.id}`}
      className="block bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 hover:shadow-md transition-shadow"
    >
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 line-clamp-2">
        {thread.title}
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
        {thread.content.substring(0, 150)}...
      </p>
      <div className="flex items-center gap-3 mt-3 text-xs text-gray-500 dark:text-gray-400">
        {thread.municipalityName &&
          (thread.municipalityId ? (
            <Link
              to={`/kunnat/${thread.municipalityId}`}
              onClick={(e) => e.stopPropagation()}
              className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded hover:opacity-80 transition-opacity"
            >
              {thread.municipalityName}
            </Link>
          ) : (
            <span className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
              {thread.municipalityName}
            </span>
          ))}
        <span className="flex items-center gap-1">
          <MessageSquare className="w-3.5 h-3.5" />
          {thread.replyCount}
        </span>
        <span>{formatDateLong(thread.createdAt)}</span>
      </div>
      {thread.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {thread.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

export function UserProfilePage() {
  const { t } = useTranslation(["profile", "agora", "common"]);
  const { userId } = useParams<{ userId: string }>();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const startConversationMutation = useStartConversation();
  const [sendingMessage, setSendingMessage] = useState(false);

  const handleSendMessage = async () => {
    if (!userId || sendingMessage) return;
    setSendingMessage(true);
    try {
      const conversation = await startConversationMutation.mutateAsync(userId);
      navigate(`/messages/${conversation.id}`);
    } catch (err) {
      console.error("Failed to start conversation:", err);
      setSendingMessage(false);
    }
  };

  const {
    data: user,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["userProfile", userId],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(`/api/v1/users/${userId}`), {
        credentials: "include",
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      return data.data as UserProfile;
    },
    enabled: !!userId,
  });

  const isOwnProfile = currentUser?.id === userId;
  const isInstitution = user?.role === "institution";
  const hasTopic = isInstitution && user?.institutionTopic;

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error || !user) {
    return (
      <Layout>
        <div className="p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            {t("profile:userProfile.notFound")}
          </p>
          <Link
            to="/agora"
            className="text-blue-600 hover:underline mt-2 inline-block"
          >
            {t("profile:userProfile.backToAgora")}
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <SEOHead
        title={user.name}
        description={`${user.name} Eulesia-alustalla`}
        path={`/user/${userId}`}
        type="profile"
        image={user.avatarUrl}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          mainEntity: {
            "@type": "Person",
            name: user.name,
            ...(user.avatarUrl && { image: user.avatarUrl }),
            url: `https://eulesia.org/user/${userId}`,
          },
        }}
      />
      {/* Back navigation */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("profile:userProfile.back")}
        </button>
      </div>

      {/* Profile header */}
      <div
        className={`bg-gradient-to-b ${isInstitution ? "from-violet-50 dark:from-violet-950/30" : "from-blue-50 dark:from-blue-950/30"} to-white dark:to-gray-950 px-4 py-6`}
      >
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div
            className={`w-20 h-20 ${isInstitution ? "bg-violet-600" : "bg-blue-600"} rounded-full flex items-center justify-center flex-shrink-0`}
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <span className="text-white text-2xl font-bold">
                {getAvatarInitials(user.name)}
              </span>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">
              {user.name}
            </h1>
            {user.verifiedName && user.verifiedName !== user.name && (
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                ({user.verifiedName})
              </p>
            )}

            {isInstitution && user.institutionName && (
              <div className="flex items-center gap-1.5 text-sm text-teal-700 dark:text-teal-400 mt-1">
                <Building2 className="w-4 h-4" />
                <span>{user.institutionName}</span>
              </div>
            )}

            {user.identityVerified && (
              <div className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full w-fit mt-2">
                <Shield className="w-3 h-3" />
                <span>{t("profile:userProfile.verified")}</span>
              </div>
            )}

            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-2">
              <Calendar className="w-3 h-3" />
              <span>
                {t("profile:userProfile.joined", {
                  date: formatDateLong(user.createdAt),
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Report user */}
        {!isOwnProfile && userId && (
          <div className="mt-3">
            <ReportButton contentType="user" contentId={userId} size="sm" />
          </div>
        )}

        {/* Send message & visit home buttons */}
        {!isOwnProfile && userId && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleSendMessage}
              disabled={sendingMessage}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {sendingMessage
                ? t("profile:userProfile.opening")
                : t("profile:userProfile.sendMessage")}
            </button>
            <Link
              to={`/home/${userId}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <Home className="w-4 h-4" />
              {t("profile:userProfile.visitHome")}
            </Link>
          </div>
        )}

        {/* Follow buttons for institutions — dual follow */}
        {!isOwnProfile && userId && isInstitution && (
          <div className="mt-4 space-y-3">
            {/* Follow institution (official posts) */}
            <div className="flex items-center gap-3">
              <FollowButton entityType="user" entityId={userId} />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("profile:userProfile.followOfficialPosts")}
              </span>
            </div>

            {/* Follow topic (AI summaries + citizen discussion) */}
            {hasTopic && (
              <div className="flex items-center gap-3">
                <FollowButton
                  entityType="tag"
                  entityId={user.institutionTopic!.topicTag}
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("profile:userProfile.followAiSummaries")}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Follow button for non-institutions */}
        {!isOwnProfile && userId && !isInstitution && (
          <div className="mt-4">
            <FollowButton entityType="user" entityId={userId} />
          </div>
        )}

        {/* Edit profile link for own profile */}
        {isOwnProfile && (
          <Link
            to="/profile"
            className="mt-4 inline-block px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            {t("profile:userProfile.editProfile")}
          </Link>
        )}

        {/* Institution topic info */}
        {hasTopic && (
          <div className="mt-4 p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Hash className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <Link
                to={`/agora/tag/${encodeURIComponent(user.institutionTopic!.topicTag)}`}
                className="text-sm font-medium text-violet-700 dark:text-violet-400 hover:underline"
              >
                {user.institutionTopic!.topicTag.replace(/-/g, " ")}
              </Link>
            </div>
            {user.institutionTopic!.description && (
              <p className="text-xs text-violet-600 dark:text-violet-400">
                {user.institutionTopic!.description}
              </p>
            )}
            {user.institutionTopic!.relatedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {user.institutionTopic!.relatedTags.map((tag) => (
                  <Link
                    key={tag}
                    to={`/agora/tag/${encodeURIComponent(tag)}`}
                    className="text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded-full hover:bg-violet-200 dark:hover:bg-violet-900/40"
                  >
                    {tag.replace(/-/g, " ")}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content sections */}
      <div className="px-4 py-6 space-y-8">
        {/* Section 1: Official posts (institution's own threads) */}
        {isInstitution && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-violet-600" />
              {t("profile:userProfile.officialPosts", {
                count: user.threads.length,
              })}
            </h2>
            {user.threads.length > 0 ? (
              <div className="space-y-3">
                {user.threads.map((thread) => (
                  <ThreadListItem key={thread.id} thread={thread} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
                {t("profile:userProfile.noOfficialPosts")}
              </p>
            )}
          </div>
        )}

        {/* Section 2: Bot AI summaries */}
        {isInstitution && user.botSummaries && user.botSummaries.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              <Bot className="w-5 h-5 text-purple-600" />
              {t("profile:userProfile.aiSummaries", {
                count: user.botSummaries.length,
              })}
            </h2>
            <div className="space-y-3">
              {user.botSummaries.map((thread) => (
                <ThreadListItem key={thread.id} thread={thread} />
              ))}
            </div>
          </div>
        )}

        {/* Section 3: Citizen discussion */}
        {isInstitution &&
          user.citizenDiscussions &&
          user.citizenDiscussions.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-teal-600" />
                {t("profile:userProfile.citizenDiscussion", {
                  count: user.citizenDiscussions.length,
                })}
              </h2>
              <div className="space-y-3">
                {user.citizenDiscussions.map((thread) => (
                  <ThreadListItem key={thread.id} thread={thread} />
                ))}
              </div>
            </div>
          )}

        {/* Non-institution: just show threads */}
        {!isInstitution && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {t("profile:userProfile.discussions", {
                count: user.threads.length,
              })}
            </h2>
            {user.threads.length > 0 ? (
              <div className="space-y-3">
                {user.threads.map((thread) => (
                  <ThreadListItem key={thread.id} thread={thread} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <p>{t("profile:userProfile.noPublicDiscussions")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
