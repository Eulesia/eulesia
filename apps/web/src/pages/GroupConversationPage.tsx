import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Send,
  Lock,
  Users,
  UserPlus,
  UserMinus,
  X,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import {
  useGroupConversation,
  useSendGroupMessage,
  useMarkRead,
  useDeleteGroupMessage,
  useInviteGroupMember,
  useRemoveGroupMember,
} from "../hooks/useApi";
import { ConfirmDeleteDialog } from "../components/common";
import { useAuth } from "../hooks/useAuth";
import { useDevice } from "../hooks/useDevice";
import { useSocket } from "../hooks/useSocket";
import { useKeyboard } from "../hooks/useKeyboard";
import { LinkifiedText } from "../components/common/LinkifiedText";
import { formatRelativeTime } from "../lib/formatTime";
import { api } from "../lib/api";
import type { DirectMessage, GroupMember } from "../lib/api";
import type { SearchUserResult } from "../lib/api";

export function GroupConversationPage() {
  const { t } = useTranslation("messages");
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();
  const { currentUser } = useAuth();
  const { deviceId, isInitialized: deviceReady } = useDevice();
  const { joinDm, leaveDm, emitTypingDm, typingInDm } = useSocket();
  const { isKeyboardOpen, keyboardHeight } = useKeyboard();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    data: groupData,
    isLoading,
    error,
  } = useGroupConversation(conversationId || "");

  const sendMessageMutation = useSendGroupMessage(conversationId || "", {
    deviceId: deviceReady ? deviceId : null,
    userId: currentUser?.id ?? null,
  });
  const markReadMutation = useMarkRead(conversationId || "");
  const deleteMessageMutation = useDeleteGroupMessage(conversationId || "");

  const [newMessage, setNewMessage] = useState("");

  // Auto-resize textarea to fit content, capped at 33vh
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxH = window.innerHeight * 0.33;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, [newMessage]);

  const [showMembers, setShowMembers] = useState(false);
  const [processedProtocolMessageKey, setProcessedProtocolMessageKey] =
    useState("");
  const [roomKeyRevision, setRoomKeyRevision] = useState(0);

  // Determine current user's role
  const myMembership = groupData?.members.find(
    (m) => m.userId === currentUser?.id,
  );
  const isOwner = myMembership?.role === "owner";

  useEffect(() => {
    if (conversationId) {
      joinDm(conversationId);
      return () => {
        leaveDm(conversationId);
      };
    }
  }, [conversationId, joinDm, leaveDm]);

  useEffect(() => {
    setProcessedProtocolMessageKey("");
    setRoomKeyRevision(0);
  }, [conversationId]);

  useEffect(() => {
    if (conversationId && groupData) {
      markReadMutation.mutate();
    }
  }, [conversationId, groupData?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [groupData?.messages]);

  useEffect(() => {
    if (isKeyboardOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [isKeyboardOpen]);

  const protocolMessages = useMemo(
    () => groupData?.protocolMessages ?? [],
    [groupData?.protocolMessages],
  );
  const protocolMessageKey = useMemo(
    () => protocolMessages.map((m) => m.id).join(","),
    [protocolMessages],
  );

  // Ensure the OlmMachine knows all members' device keys before processing
  // protocol messages or decrypting group ciphertexts.
  const memberUserIds = useMemo(
    () => groupData?.members.map((m) => m.userId) ?? [],
    [groupData?.members],
  );

  useEffect(() => {
    if (!deviceReady || !deviceId || memberUserIds.length === 0) return;
    let cancelled = false;

    (async () => {
      try {
        const { ensureUserKeysKnown } = await import("../lib/e2ee/index.ts");
        await ensureUserKeysKnown(api, deviceId, memberUserIds);
      } catch (err) {
        console.warn("Failed to sync member device keys:", err);
      }
      if (cancelled) return;
      // Trigger protocol message processing after keys are known.
      setRoomKeyRevision((v) => v + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [deviceReady, deviceId, memberUserIds]);

  // Process hidden Matrix to-device payloads to import room keys and other
  // protocol state before attempting Megolm decrypts.
  useEffect(() => {
    if (protocolMessages.length === 0 || !conversationId) return;
    if (protocolMessageKey === processedProtocolMessageKey) return;

    let cancelled = false;

    (async () => {
      // Ensure member keys are known before processing protocol events.
      if (deviceReady && deviceId && memberUserIds.length > 0) {
        try {
          const { ensureUserKeysKnown } = await import("../lib/e2ee/index.ts");
          await ensureUserKeysKnown(api, deviceId, memberUserIds);
        } catch {
          // Best-effort — continue with processing.
        }
      }

      const { processMatrixGroupToDeviceMessages } = await import(
        "../lib/e2ee/matrixGroup.ts"
      );
      try {
        await processMatrixGroupToDeviceMessages(
          protocolMessages
            .map((message) => message.ciphertext)
            .filter((ciphertext): ciphertext is string => Boolean(ciphertext)),
        );
      } catch {
        // Processing protocol messages is best-effort. Decrypt retries will
        // run again if additional room-key messages arrive.
      }
      if (cancelled) return;
      setProcessedProtocolMessageKey(protocolMessageKey);
      setRoomKeyRevision((value) => value + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    protocolMessages,
    protocolMessageKey,
    conversationId,
    processedProtocolMessageKey,
    deviceReady,
    deviceId,
    memberUserIds,
  ]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversationId || !deviceReady) return;

    try {
      await sendMessageMutation.mutateAsync(newMessage.trim());
      setNewMessage("");
    } catch (err) {
      console.error("Failed to send group message:", err);
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

  if (error || !groupData) {
    return (
      <Layout>
        <div className="px-4 py-12 text-center">
          <p className="text-red-600 mb-4">
            {t("loadError", { defaultValue: "Failed to load conversation" })}
          </p>
          <button
            onClick={() => navigate("/messages")}
            className="text-teal-600 hover:underline"
          >
            {t("backToMessages", { defaultValue: "Back to Messages" })}
          </button>
        </div>
      </Layout>
    );
  }

  // Filter out hidden protocol messages — they carry Matrix room keys and
  // other to-device state, not user-visible chat.
  const messages = (groupData.messages ?? []).filter(
    (m) => m.messageType !== "to_device",
  );
  const typingUsers = conversationId ? (typingInDm[conversationId] ?? []) : [];

  return (
    <Layout showFooter={false}>
      <SEOHead
        title={groupData.name || t("groupChat", { defaultValue: "Group" })}
        path={`/messages/group/${conversationId}`}
        noIndex
      />
      <div
        className="flex flex-col"
        style={{
          height: isKeyboardOpen
            ? `calc(100dvh - 3.5rem - ${keyboardHeight}px)`
            : "calc(100dvh - 3.5rem - 5rem)",
        }}
      >
        {/* Header */}
        <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/messages")}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                {groupData.name}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("memberCount", {
                  defaultValue: "{{count}} members",
                  count: groupData.members.length,
                })}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
                <Lock className="w-3 h-3" /> E2EE
              </span>
              <button
                onClick={() => setShowMembers(!showMembers)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <Users className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
          </div>
        </div>

        {/* Member panel (slide out) */}
        {showMembers && (
          <MemberPanel
            conversationId={conversationId || ""}
            members={groupData.members}
            isOwner={isOwner}
            currentUserId={currentUser?.id ?? ""}
            onClose={() => setShowMembers(false)}
          />
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-gradient-to-b from-white to-gray-50/80 dark:from-gray-950 dark:to-gray-900/30">
          <div className="px-4 py-5 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("noGroupMessages", {
                    defaultValue: "No messages yet. Start the conversation!",
                  })}
                </p>
              </div>
            ) : (
              messages.map((msg: DirectMessage) => (
                <GroupMessageBubble
                  key={msg.id}
                  message={msg}
                  roomKeyRevision={roomKeyRevision}
                  isOwnMessage={
                    (msg.senderId ?? msg.author?.id) === currentUser?.id
                  }
                  onDelete={(messageId) =>
                    deleteMessageMutation.mutate(messageId)
                  }
                />
              ))
            )}
            {typingUsers.length > 0 && (
              <div className="flex items-center gap-2 px-1 text-sm text-gray-500 dark:text-gray-400">
                <span className="flex gap-0.5">
                  <span
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </span>
                <span>{t("typing")}</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Device warning */}
        {!deviceReady && (
          <div className="flex-shrink-0 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800 text-center">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t("deviceNotRegistered", {
                defaultValue:
                  "Your device is not registered for encryption. Go to Settings to set up a device.",
              })}
            </p>
          </div>
        )}

        {/* Input bar */}
        <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 px-4 py-3">
          <form onSubmit={handleSendMessage} className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value);
                if (conversationId && e.target.value.trim())
                  emitTypingDm(conversationId);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  textareaRef.current?.form?.requestSubmit();
                }
              }}
              placeholder={t("writeMessage")}
              disabled={!deviceReady}
              rows={1}
              className="flex-1 px-4 py-2.5 rounded-2xl border border-emerald-300/60 dark:border-emerald-600/40 bg-emerald-50/50 dark:bg-emerald-950/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors disabled:opacity-50 resize-y overflow-y-auto max-h-[33vh]"
            />
            <button
              type="submit"
              disabled={
                !newMessage.trim() ||
                sendMessageMutation.isPending ||
                !deviceReady
              }
              className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-teal-600 text-white rounded-full hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
              aria-label={t("sendMessage")}
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Decrypt group E2EE message on demand.
// ---------------------------------------------------------------------------

function useGroupDecryptedContent(
  message: DirectMessage,
  roomKeyRevision: number,
): {
  content: string;
  isDecrypting: boolean;
  decryptionFailed: boolean;
} {
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptionFailed, setDecryptionFailed] = useState(false);
  const [lastAttemptedRevision, setLastAttemptedRevision] = useState(-1);

  const decrypt = useCallback(async () => {
    if (!message.ciphertext) return;
    setIsDecrypting(true);
    setDecryptionFailed(false);
    try {
      const { decryptGroupMessage } = await import("../lib/e2ee/index.ts");
      const senderUserId = message.senderId ?? message.author?.id;
      if (!senderUserId) {
        throw new Error("Missing group message sender");
      }
      const plaintext = await decryptGroupMessage(
        message.conversationId,
        message.ciphertext,
        message.id,
        senderUserId,
        message.createdAt,
      );
      setDecrypted(plaintext);
    } catch {
      setDecryptionFailed(true);
    } finally {
      setIsDecrypting(false);
    }
  }, [message.ciphertext, message.conversationId]);

  useEffect(() => {
    if (!message.ciphertext || decrypted) return;
    if (lastAttemptedRevision === roomKeyRevision) return;

    setLastAttemptedRevision(roomKeyRevision);
    if (!isDecrypting) {
      decrypt();
    }
  }, [
    message.id,
    message.ciphertext,
    decrypted,
    roomKeyRevision,
    lastAttemptedRevision,
    isDecrypting,
    decrypt,
  ]);

  useEffect(() => {
    setDecrypted(null);
    setDecryptionFailed(false);
    setLastAttemptedRevision(-1);
  }, [message.id]);

  return {
    content: decrypted ?? message.content ?? "",
    isDecrypting,
    decryptionFailed,
  };
}

// ---------------------------------------------------------------------------
// Group message bubble
// ---------------------------------------------------------------------------

function useLongPress(callback: () => void, ms = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTouchStart = useCallback(() => {
    timerRef.current = setTimeout(callback, ms);
  }, [callback, ms]);
  const onTouchEnd = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  return { onTouchStart, onTouchEnd, onTouchMove: onTouchEnd };
}

function GroupMessageBubble({
  message,
  isOwnMessage,
  roomKeyRevision,
  onDelete,
}: {
  message: DirectMessage;
  isOwnMessage: boolean;
  roomKeyRevision: number;
  onDelete: (messageId: string) => void;
}) {
  const { t } = useTranslation(["messages", "common"]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const {
    content: displayContent,
    isDecrypting,
    decryptionFailed,
  } = useGroupDecryptedContent(message, roomKeyRevision);

  const openContextMenu = useCallback(
    (x: number, y: number) => {
      if (isOwnMessage) setContextMenu({ x, y });
    },
    [isOwnMessage],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!isOwnMessage) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY);
    },
    [isOwnMessage, openContextMenu],
  );

  const longPress = useLongPress(() => {
    if (isOwnMessage) openContextMenu(0, 0);
  });

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  return (
    <div className={`flex gap-3 ${isOwnMessage ? "flex-row-reverse" : ""}`}>
      <div
        className={`relative max-w-[75%] rounded-2xl px-4 py-3 shadow-sm ${
          isOwnMessage
            ? "bg-teal-600 text-white rounded-br-md"
            : "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-md border border-gray-100 dark:border-gray-700/50"
        }`}
        onContextMenu={handleContextMenu}
        {...longPress}
      >
        {!isOwnMessage && message.author && (
          <p className="text-xs font-medium text-teal-600 dark:text-teal-400 mb-0.5">
            {message.author.name}
          </p>
        )}
        {isDecrypting ? (
          <p className="text-sm italic opacity-60">Decrypting...</p>
        ) : decryptionFailed ? (
          <p className="text-sm italic opacity-60">Waiting for room key...</p>
        ) : (
          <LinkifiedText
            text={displayContent}
            className="text-sm whitespace-pre-wrap break-words"
            showPreviews={!isOwnMessage}
          />
        )}
        <div
          className={`flex items-center gap-1 mt-1 ${
            isOwnMessage ? "justify-end" : ""
          }`}
        >
          <span
            className={`text-[10px] ${
              isOwnMessage
                ? "text-teal-200"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {formatRelativeTime(message.createdAt)}
          </span>
        </div>
        {contextMenu && (
          <div
            className="fixed z-50 min-w-[140px] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1"
            style={
              contextMenu.x
                ? { left: contextMenu.x, top: contextMenu.y }
                : { right: 16, top: "50%", transform: "translateY(-50%)" }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setContextMenu(null);
                setShowDeleteConfirm(true);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("common:actions.delete")}
            </button>
          </div>
        )}
      </div>
      <ConfirmDeleteDialog
        open={showDeleteConfirm}
        type="message"
        onConfirm={() => {
          onDelete(message.id);
          setShowDeleteConfirm(false);
        }}
        onClose={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Member panel
// ---------------------------------------------------------------------------

function MemberPanel({
  conversationId,
  members,
  isOwner,
  currentUserId,
  onClose,
}: {
  conversationId: string;
  members: GroupMember[];
  isOwner: boolean;
  currentUserId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("messages");
  const inviteMutation = useInviteGroupMember(conversationId);
  const removeMutation = useRemoveGroupMember(conversationId);
  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const memberIds = new Set(members.map((m) => m.userId));

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await api.searchUsers(query.trim(), 10);
        setSearchResults(results.filter((u) => !memberIds.has(u.id)));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const handleInvite = async (userId: string) => {
    try {
      await inviteMutation.mutateAsync(userId);
      setSearchQuery("");
      setSearchResults([]);
      setShowInvite(false);
    } catch (err) {
      console.error("Failed to invite member:", err);
    }
  };

  return (
    <div className="flex-shrink-0 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 px-4 py-3 max-h-64 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t("members", { defaultValue: "Members" })} ({members.length})
        </h3>
        <div className="flex items-center gap-1">
          {isOwner && (
            <button
              onClick={() => setShowInvite(!showInvite)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500"
            >
              <UserPlus className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Invite search */}
      {showInvite && (
        <div className="mb-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={t("searchUsers", {
                defaultValue: "Search users to invite...",
              })}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
          {isSearching && (
            <p className="text-xs text-gray-400 mt-1">
              {t("searching", { defaultValue: "Searching..." })}
            </p>
          )}
          {searchResults.length > 0 && (
            <div className="mt-1 space-y-1">
              {searchResults.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleInvite(user.id)}
                  disabled={inviteMutation.isPending}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
                >
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {user.name}
                  </span>
                  <UserPlus className="w-3.5 h-3.5 text-teal-600 ml-auto" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Member list */}
      <div className="space-y-1">
        {members.map((member) => (
          <div
            key={member.userId}
            className="flex items-center justify-between py-1"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center">
                {member.avatarUrl ? (
                  <img
                    src={member.avatarUrl}
                    alt=""
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span className="text-white text-[10px] font-bold">
                    {member.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                )}
              </div>
              <span className="text-sm text-gray-900 dark:text-gray-100">
                {member.name}
                {member.userId === currentUserId && (
                  <span className="text-xs text-gray-400 ml-1">
                    ({t("you", { defaultValue: "you" })})
                  </span>
                )}
              </span>
              {member.role === "owner" && (
                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                  {t("owner", { defaultValue: "Owner" })}
                </span>
              )}
            </div>
            {isOwner && member.userId !== currentUserId && (
              <button
                onClick={() => removeMutation.mutate(member.userId)}
                disabled={removeMutation.isPending}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                title={t("removeMember", { defaultValue: "Remove member" })}
              >
                <UserMinus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
