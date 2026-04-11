import { useState, useRef, useEffect, useCallback } from "react";
import { ContentWithPreviews } from "../components/common/ContentWithPreviews";
import { LinkifiedText } from "../components/common/LinkifiedText";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Send,
  Pencil,
  Trash2,
  Check,
  Lock,
  Unlock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import {
  ActorBadge,
  EditedIndicator,
  ConfirmDeleteDialog,
} from "../components/common";
import { useQuery } from "@tanstack/react-query";
import {
  useConversation,
  useSendDM,
  useMarkRead,
  useEditDirectMessage,
  useDeleteDirectMessage,
} from "../hooks/useApi";
import { api } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { useDevice } from "../hooks/useDevice";
import { useSocket } from "../hooks/useSocket";
import { useKeyboard } from "../hooks/useKeyboard";
import { formatRelativeTime } from "../lib/formatTime";
import type { DirectMessage } from "../lib/api";
import { getAvatarInitials } from "../utils/avatar";
import { loadCachedDmPlaintext } from "../lib/e2ee/dmPlaintextCache.ts";

/**
 * Hook to decrypt an E2EE message on demand. Returns the decrypted content
 * when available.
 */
function useDecryptedContent(
  message: DirectMessage,
  keysReady = true,
): {
  content: string;
  isDecrypting: boolean;
  decryptionFailed: boolean;
} {
  const { currentUser } = useAuth();
  const { deviceId, isInitialized: isCryptoReady } = useDevice();
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptionFailed, setDecryptionFailed] = useState(false);

  const decrypt = useCallback(async () => {
    if (!isCryptoReady || !message.ciphertext || !message.senderDeviceId) {
      return;
    }

    setIsDecrypting(true);
    try {
      const { decryptConversationMessage } = await import(
        "../lib/e2ee/index.ts"
      );
      const plaintext = await decryptConversationMessage(
        message.conversationId,
        message.senderDeviceId,
        message.ciphertext,
        message.id,
      );
      setDecryptedContent(plaintext);
    } catch (err) {
      console.warn("Message decryption failed:", err);
      setDecryptionFailed(true);
    } finally {
      setIsDecrypting(false);
    }
  }, [
    isCryptoReady,
    message.id,
    message.ciphertext,
    message.senderDeviceId,
    message.conversationId,
  ]);

  useEffect(() => {
    setDecryptedContent(null);
    setDecryptionFailed(false);
  }, [
    isCryptoReady,
    currentUser?.id,
    deviceId,
    message.id,
    message.ciphertext,
    message.senderDeviceId,
    message.conversationId,
  ]);

  useEffect(() => {
    if (
      message.ciphertext ||
      !deviceId ||
      !currentUser ||
      message.senderId !== currentUser.id ||
      message.senderDeviceId !== deviceId
    ) {
      return;
    }

    const cached = loadCachedDmPlaintext({
      messageId: message.id,
      deviceId,
      senderId: currentUser.id,
    });
    if (cached) {
      setDecryptedContent(cached);
    }
  }, [
    currentUser,
    deviceId,
    message.ciphertext,
    message.id,
    message.senderDeviceId,
    message.senderId,
  ]);

  useEffect(() => {
    if (
      isCryptoReady &&
      keysReady &&
      message.ciphertext &&
      message.senderDeviceId &&
      !decryptedContent &&
      !decryptionFailed
    ) {
      decrypt();
    }
  }, [
    message.ciphertext,
    message.senderDeviceId,
    decryptedContent,
    decryptionFailed,
    isCryptoReady,
    keysReady,
    decrypt,
  ]);

  const content =
    message.ciphertext && !decryptedContent
      ? ""
      : (decryptedContent ?? message.content ?? "");

  return { content, isDecrypting, decryptionFailed };
}

interface DMMessageBubbleProps {
  message: DirectMessage;
  isOwnMessage: boolean;
  isEncrypted: boolean;
  keysReady: boolean;
  onEdit: (messageId: string, content: string) => void;
  onDelete: (messageId: string) => void;
}

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

function MessageBubble({
  message,
  isOwnMessage,
  isEncrypted,
  keysReady,
  onEdit,
  onDelete,
}: DMMessageBubbleProps) {
  const { t } = useTranslation(["messages", "common"]);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const {
    content: displayContent,
    isDecrypting,
    decryptionFailed,
  } = useDecryptedContent(message, keysReady);

  const openContextMenu = useCallback(
    (x: number, y: number) => {
      if (isOwnMessage && !isEditing) setContextMenu({ x, y });
    },
    [isOwnMessage, isEditing],
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

  // Close context menu on outside click
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

  if (message.isHidden) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-xs text-gray-400 dark:text-gray-500 italic">
          {t("common:messageDeleted")}
        </span>
      </div>
    );
  }

  const handleStartEdit = () => {
    setEditContent(displayContent);
    setIsEditing(true);
    setContextMenu(null);
  };

  const handleSaveEdit = () => {
    if (editContent.trim()) {
      onEdit(message.id, editContent.trim());
      setIsEditing(false);
    }
  };

  return (
    <div
      className={`group flex gap-3 ${isOwnMessage ? "flex-row-reverse" : ""}`}
    >
      <div className="flex-shrink-0">
        {message.author && (
          <ActorBadge
            user={{
              ...message.author,
              avatarInitials: getAvatarInitials(message.author.name),
            }}
            showName={false}
            size="sm"
          />
        )}
      </div>
      <div className={`max-w-[75%] ${isOwnMessage ? "text-right" : ""}`}>
        <div className="flex items-baseline gap-2 mb-1">
          <span
            className={`text-sm font-medium text-gray-800 dark:text-gray-200 ${isOwnMessage ? "order-2" : ""}`}
          >
            {message.author?.name}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {formatRelativeTime(message.createdAt)}
          </span>
          {message.editedAt && <EditedIndicator editedAt={message.editedAt} />}
        </div>
        {isEditing ? (
          <div className="text-left">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full p-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              rows={3}
              autoFocus
            />
            <div className="flex gap-2 mt-1">
              <button
                onClick={handleSaveEdit}
                disabled={!editContent.trim()}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded hover:bg-teal-700 disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                {t("common:actions.save")}
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                {t("common:actions.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="relative inline-block"
            onContextMenu={handleContextMenu}
            {...longPress}
          >
            <div
              className={`px-4 py-3 rounded-2xl shadow-sm ${
                isOwnMessage
                  ? "bg-teal-600 text-white rounded-br-md"
                  : "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-md border border-gray-100 dark:border-gray-700"
              }`}
            >
              {isDecrypting ? (
                <p className="text-sm italic opacity-60">Decrypting...</p>
              ) : decryptionFailed ? (
                <p className="text-sm italic opacity-60">
                  Unable to decrypt message
                </p>
              ) : message.contentHtml && !message.ciphertext ? (
                <ContentWithPreviews
                  html={message.contentHtml}
                  className={`prose prose-sm max-w-none ${
                    isOwnMessage ? "prose-invert" : "dark:prose-invert"
                  }`}
                />
              ) : (
                <LinkifiedText
                  text={displayContent}
                  className="text-sm whitespace-pre-wrap break-words"
                  showPreviews={!isOwnMessage}
                />
              )}
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
                {!isEncrypted && (
                  <button
                    onClick={handleStartEdit}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {t("common:actions.edit")}
                  </button>
                )}
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

export function DMConversationPage() {
  const { t } = useTranslation("messages");
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();
  const { currentUser } = useAuth();
  const { deviceId, isInitialized: deviceReady } = useDevice();
  const { joinDm, leaveDm, emitTypingDm, typingInDm } = useSocket();
  const { isKeyboardOpen, keyboardHeight } = useKeyboard();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    data: conversationData,
    isLoading,
    error,
  } = useConversation(conversationId || "");

  // Derive otherUser from members list (v2 API doesn't have a dedicated field)
  const otherMember = conversationData?.members?.find(
    (m) => m.userId !== currentUser?.id,
  );
  const otherUser = otherMember
    ? {
        id: otherMember.userId,
        name: otherMember.name,
        avatarUrl: otherMember.avatarUrl ?? null,
        role: "citizen" as const,
      }
    : (conversationData?.otherUser ?? null);
  const otherUserId = otherUser?.id ?? null;
  const isEncryptedConversation = conversationData?.encryption === "e2ee";

  // Check if recipient has a registered device (required for E2EE).
  const { data: recipientDevices, isError: recipientDevicesError } = useQuery({
    queryKey: ["userDevices", otherUserId],
    queryFn: () => api.getUserDevices(otherUserId!),
    enabled: !!otherUserId && isEncryptedConversation,
  });
  const recipientHasDevice = !!recipientDevices && recipientDevices.length > 0;
  const canSend = isEncryptedConversation
    ? deviceReady && (recipientHasDevice || recipientDevicesError)
    : true;

  const sendMessageMutation = useSendDM(conversationId || "", {
    encryption: isEncryptedConversation ? "e2ee" : "none",
    deviceId: deviceReady ? deviceId : null,
    userId: currentUser?.id ?? null,
    otherUserId,
  });
  const markReadMutation = useMarkRead(conversationId || "");
  const editMessageMutation = useEditDirectMessage(conversationId || "");
  const deleteMessageMutation = useDeleteDirectMessage(conversationId || "");

  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [keysReady, setKeysReady] = useState(false);

  // Ensure the OlmMachine knows the other participant's device keys before
  // any decryption attempt.  Without this the machine can't verify or decrypt
  // Olm pre-key messages from the sender.
  useEffect(() => {
    if (!isEncryptedConversation) {
      setKeysReady(true);
      return;
    }

    setKeysReady(false);
    if (!deviceReady || !deviceId || !otherUserId || !currentUser?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const { ensureUserKeysKnown } = await import("../lib/e2ee/index.ts");
        await ensureUserKeysKnown(api, deviceId, [otherUserId, currentUser.id]);
        if (!cancelled) setKeysReady(true);
      } catch (err) {
        console.warn("Failed to sync participant device keys:", err);
        // Allow decryption attempts anyway — cached keys may be sufficient
        if (!cancelled) setKeysReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentUser?.id,
    deviceId,
    deviceReady,
    isEncryptedConversation,
    otherUserId,
  ]);

  // Auto-resize textarea to fit content, capped at 33vh
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxH = window.innerHeight * 0.33;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, [newMessage]);

  useEffect(() => {
    if (conversationId) {
      joinDm(conversationId);
      return () => {
        leaveDm(conversationId);
      };
    }
  }, [conversationId, joinDm, leaveDm]);

  useEffect(() => {
    if (conversationId && conversationData) {
      markReadMutation.mutate();
    }
  }, [conversationId, conversationData?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationData?.messages]);

  useEffect(() => {
    if (isKeyboardOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [isKeyboardOpen]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversationId) return;

    try {
      await sendMessageMutation.mutateAsync(newMessage.trim());
      setNewMessage("");
    } catch (err) {
      console.error("Failed to send message:", err);
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

  if (error || !conversationData) {
    return (
      <Layout>
        <div className="px-4 py-12 text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">
            {t("loadError")}
          </p>
          <Link
            to="/messages"
            className="text-teal-600 dark:text-teal-400 hover:underline"
          >
            {t("backToMessages")}
          </Link>
        </div>
      </Layout>
    );
  }

  const { messages } = conversationData;
  const canLinkToOtherUserProfile =
    Boolean(otherUser?.id) && (otherUser?.canViewProfile ?? true);

  const otherUserHeader = otherUser ? (
    <>
      <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center flex-shrink-0">
        {otherUser.avatarUrl ? (
          <img
            src={otherUser.avatarUrl}
            alt={otherUser.name}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <span className="text-gray-600 dark:text-gray-300 text-sm font-bold">
            {getAvatarInitials(otherUser.name)}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
          {otherUser.name}
        </h1>
        {otherUser.institutionName && (
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {otherUser.institutionName}
          </p>
        )}
      </div>
    </>
  ) : null;

  return (
    <Layout showFooter={false}>
      <SEOHead
        title={t("title")}
        path={`/messages/${conversationId}`}
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
              onClick={() => navigate(-1)}
              className="p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
            {otherUser && canLinkToOtherUserProfile && (
              <Link
                to={`/user/${otherUser.id}`}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                {otherUserHeader}
              </Link>
            )}
            {otherUser && !canLinkToOtherUserProfile && (
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {otherUserHeader}
              </div>
            )}
            {/* Encryption status */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
                isEncryptedConversation
                  ? "bg-emerald-50 dark:bg-emerald-950/30"
                  : "bg-gray-100 dark:bg-gray-800"
              }`}
              title={
                isEncryptedConversation
                  ? t("encryptionEnabled", {
                      defaultValue: "End-to-end encrypted",
                    })
                  : t("encryptionDisabled", {
                      defaultValue: "Not encrypted",
                    })
              }
            >
              {isEncryptedConversation ? (
                <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Unlock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
              )}
              <span
                className={`text-xs font-medium ${
                  isEncryptedConversation
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {isEncryptedConversation
                  ? t("encrypted", { defaultValue: "E2EE" })
                  : t("plaintext", { defaultValue: "Plain" })}
              </span>
            </div>
          </div>
        </div>

        {/* Messages area — contained surface with subtle pattern */}
        <div className="flex-1 overflow-y-auto bg-gradient-to-b from-white to-gray-50/80 dark:from-gray-950 dark:to-gray-900/30">
          <div className="px-4 py-5 space-y-4 min-h-full">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                  <Send className="w-7 h-7 text-gray-300 dark:text-gray-600" />
                </div>
                <p className="text-gray-500 dark:text-gray-400 font-medium">
                  {t("noMessagesYet")}
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  {t("sendFirstMessage")}
                </p>
              </div>
            ) : (
              messages.map((msg: DirectMessage) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwnMessage={msg.author?.id === currentUser?.id}
                  isEncrypted={conversationData?.encryption === "e2ee"}
                  keysReady={keysReady}
                  onEdit={(messageId, content) =>
                    editMessageMutation.mutate({ messageId, content })
                  }
                  onDelete={(messageId) =>
                    deleteMessageMutation.mutate(messageId)
                  }
                />
              ))
            )}
            {/* Typing indicator */}
            {conversationId &&
              (typingInDm[conversationId]?.length ?? 0) > 0 && (
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

        {/* Device warning banners */}
        {isEncryptedConversation && !deviceReady && (
          <div className="flex-shrink-0 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800 text-center">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t("deviceNotRegistered", {
                defaultValue:
                  "Your device is not registered for encryption. Go to Settings to set up a device.",
              })}
            </p>
            <Link
              to="/profile"
              className="text-sm text-amber-600 dark:text-amber-400 underline"
            >
              {t("goToSettings", { defaultValue: "Settings" })}
            </Link>
          </div>
        )}
        {isEncryptedConversation &&
          deviceReady &&
          recipientDevicesError &&
          otherUserId && (
            <div className="flex-shrink-0 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800 text-center">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {t("recipientDeviceCheckFailed", {
                  defaultValue:
                    "Could not verify whether the recipient has a registered device.",
                })}
              </p>
            </div>
          )}
        {isEncryptedConversation &&
          deviceReady &&
          !recipientDevicesError &&
          !recipientHasDevice &&
          otherUserId && (
            <div className="flex-shrink-0 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800 text-center">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {t("recipientNoDevice", {
                  defaultValue:
                    "The other user has no registered device. Encrypted messaging is not available until they set up a device.",
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
              disabled={!canSend}
              rows={1}
              className={`flex-1 px-4 py-2.5 rounded-2xl text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 transition-colors disabled:opacity-50 resize-y overflow-y-auto max-h-[33vh] ${
                isEncryptedConversation
                  ? "border border-emerald-300/60 dark:border-emerald-600/40 bg-emerald-50/50 dark:bg-emerald-950/20 focus:ring-emerald-500 focus:border-transparent"
                  : "border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-teal-500 focus:border-transparent"
              }`}
            />
            <button
              type="submit"
              disabled={
                !newMessage.trim() || sendMessageMutation.isPending || !canSend
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
