import { Link } from "react-router-dom";
import { MessageSquare, Search, Users, Plus, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { useConversations } from "../hooks/useApi";

import { formatMessageDate } from "../lib/formatTime";
import type { Conversation } from "../lib/api";

function getAvatarInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ConversationItem({ conversation }: { conversation: Conversation }) {
  const { t } = useTranslation("messages");
  const { otherUser, lastMessage, unreadCount, updatedAt } = conversation;

  // For DMs use the other user's info; for groups use conversation name
  const displayName =
    otherUser?.name || conversation.name || t("groupConversation");
  const avatarUrl = otherUser?.avatarUrl;

  const isGroup = conversation.conversationType === "group";
  const privacyLabel = isGroup ? t("privateGroup") : t("privateChat");
  const preview =
    lastMessage?.content?.substring(0, 80) ??
    (lastMessage ? t("encryptedMessagePreview") : t("noMessagesPreview"));
  const path = isGroup
    ? `/messages/group/${conversation.id}`
    : `/messages/${conversation.id}`;

  return (
    <Link
      to={path}
      title={`${privacyLabel} • ${t("e2eeLabel")}`}
      className="flex items-center gap-3 px-4 py-3 transition-colors border-b border-emerald-100 dark:border-emerald-950/40 bg-gradient-to-r from-emerald-50/80 via-white to-teal-50/60 dark:from-emerald-950/20 dark:via-gray-900 dark:to-teal-950/10 hover:from-emerald-100/80 hover:to-teal-100/70 dark:hover:from-emerald-950/30 dark:hover:to-teal-950/20"
    >
      {/* Avatar */}
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${
          isGroup
            ? "from-emerald-600 to-teal-700"
            : "from-emerald-500 to-cyan-600"
        }`}
      >
        {isGroup ? (
          <Users className="w-6 h-6 text-white" />
        ) : avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <span className="text-white text-sm font-bold">
            {getAvatarInitials(displayName)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`text-sm truncate ${unreadCount > 0 ? "font-bold text-gray-900 dark:text-gray-100" : "font-medium text-gray-900 dark:text-gray-100"}`}
            >
              {displayName}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/40 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <Lock className="w-3 h-3" />
              {privacyLabel}
            </span>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
            {formatMessageDate(lastMessage?.createdAt || updatedAt)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <div className="min-w-0">
            <span className="inline-flex sm:hidden items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/40 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <Lock className="w-3 h-3" />
              {privacyLabel}
            </span>
            <p
              className={`text-sm truncate ${unreadCount > 0 ? "text-gray-900 dark:text-gray-100 font-medium" : "text-gray-500 dark:text-gray-400"} ${isGroup ? "mt-1" : ""}`}
            >
              {preview}
            </p>
          </div>
          {unreadCount > 0 && (
            <span className="ml-2 bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function MessagesPage() {
  const { t } = useTranslation("messages");
  const { data: conversations, isLoading } = useConversations();

  return (
    <Layout>
      <SEOHead title={t("title")} path="/messages" noIndex />
      {/* Header */}
      <div
        className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-4"
        data-guide="messages-header"
      >
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {t("title")}
          </h1>
          <Link
            to="/messages/new-group"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("newGroup", { defaultValue: "New Group" })}
          </Link>
        </div>
      </div>

      {/* Conversations list */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : conversations && conversations.length > 0 ? (
        <div
          className="bg-white dark:bg-gray-900"
          data-guide="messages-conversation"
        >
          {conversations.map((conv) => (
            <ConversationItem key={conv.id} conversation={conv} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 px-4">
          <MessageSquare className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            {t("noConversations")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {t("noConversationsHint")}
          </p>
          <Link
            to="/agora"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-800 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Search className="w-4 h-4" />
            {t("common:nav.agora")}
          </Link>
        </div>
      )}
    </Layout>
  );
}
