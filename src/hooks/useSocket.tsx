import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { useAuth } from "./useAuth";
import { queryKeys } from "./useApi";
import { API_BASE_URL } from "../lib/runtimeConfig";
import type { DirectMessage, ConversationWithMessages } from "../lib/api";

const TYPING_TIMEOUT_MS = 3000;
const TYPING_THROTTLE_MS = 2000;

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinDm: (conversationId: string) => void;
  leaveDm: (conversationId: string) => void;
  emitTypingDm: (conversationId: string) => void;
  typingInDm: Record<string, string[]>;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [typingInDm, setTypingInDm] = useState<Record<string, string[]>>({});
  const { isAuthenticated, currentUser } = useAuth();
  const queryClient = useQueryClient();

  // Track typing timeouts so we can clear them
  const dmTypingTimeouts = useRef<
    Record<string, Record<string, ReturnType<typeof setTimeout>>>
  >({});
  // Throttle outgoing typing events
  const lastTypingEmit = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!isAuthenticated || !currentUser) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    const newSocket = io(API_BASE_URL || undefined, {
      withCredentials: true,
      autoConnect: true,
      transports: ["websocket", "polling"],
    });

    newSocket.on("connect", () => {
      setIsConnected(true);
      // Join user-specific room for notifications
      newSocket.emit("join:user", currentUser.id);
    });

    newSocket.on("disconnect", () => {
      setIsConnected(false);
    });

    newSocket.on("error", (error) => {
      console.error("Socket error:", error);
    });

    // Handle DM typing indicators
    newSocket.on(
      "user_typing_dm",
      (data: { conversationId: string; userId: string }) => {
        if (data.userId === currentUser.id) return;
        addTypingUser(data.conversationId, data.userId);
      },
    );

    // Handle new notification events
    newSocket.on("new_notification", () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationUnreadCount,
      });
    });

    // Handle thread/comment edits & deletes via invalidation
    newSocket.on("thread_edited", () => {
      queryClient.invalidateQueries({ queryKey: ["thread"] });
    });

    newSocket.on("thread_deleted", () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    });

    newSocket.on("comment_edited", (data: { threadId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["thread", data.threadId] });
    });

    newSocket.on("comment_deleted", (data: { threadId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["thread", data.threadId] });
    });

    // Handle DM message edits
    newSocket.on(
      "dm_message_edited",
      (data: {
        conversationId: string;
        messageId: string;
        content: string;
        contentHtml: string;
        editedAt: string;
      }) => {
        queryClient.setQueryData(
          queryKeys.conversation(data.conversationId),
          (old: ConversationWithMessages | undefined) => {
            if (!old) return old;
            return {
              ...old,
              messages: old.messages.map((m: DirectMessage) =>
                m.id === data.messageId
                  ? {
                      ...m,
                      content: data.content,
                      contentHtml: data.contentHtml,
                      editedAt: data.editedAt,
                    }
                  : m,
              ),
            };
          },
        );
      },
    );

    // Handle DM message deletes
    newSocket.on(
      "dm_message_deleted",
      (data: { conversationId: string; messageId: string }) => {
        queryClient.setQueryData(
          queryKeys.conversation(data.conversationId),
          (old: ConversationWithMessages | undefined) => {
            if (!old) return old;
            return {
              ...old,
              messages: old.messages.filter(
                (m: DirectMessage) => m.id !== data.messageId,
              ),
            };
          },
        );
      },
    );

    // Handle new DM message events
    newSocket.on(
      "new_dm_message",
      (data: { conversationId: string; message: DirectMessage }) => {
        // Update the conversation messages in the cache
        queryClient.setQueryData(
          queryKeys.conversation(data.conversationId),
          (old: ConversationWithMessages | undefined) => {
            if (!old) return old;
            return {
              ...old,
              messages: [...old.messages, data.message],
            };
          },
        );
        // Invalidate conversations list to update last message & unread count
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
        // Update unread DM badge
        queryClient.invalidateQueries({ queryKey: queryKeys.dmUnreadCount });
        // Clear typing for the user who sent the message
        clearTypingUser(data.conversationId, data.message.author?.id);
      },
    );

    setSocket(newSocket);

    // Native app lifecycle: reconnect socket on resume
    let resumeListener: Awaited<ReturnType<typeof CapApp.addListener>> | null =
      null;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener("resume", () => {
        if (!newSocket.connected) {
          newSocket.connect();
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
        queryClient.invalidateQueries({
          queryKey: queryKeys.notificationUnreadCount,
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.dmUnreadCount });
      }).then((l) => {
        resumeListener = l;
      });
    }

    return () => {
      newSocket.emit("leave:user", currentUser.id);
      newSocket.disconnect();
      resumeListener?.remove();
    };
  }, [isAuthenticated, currentUser, queryClient]);

  function addTypingUser(channelId: string, userId: string) {
    const timeouts = dmTypingTimeouts;
    const setter = setTypingInDm;

    // Clear existing timeout for this user
    if (timeouts.current[channelId]?.[userId]) {
      clearTimeout(timeouts.current[channelId][userId]);
    }

    // Add user to typing list
    setter((prev) => {
      const current = prev[channelId] || [];
      if (!current.includes(userId)) {
        return { ...prev, [channelId]: [...current, userId] };
      }
      return prev;
    });

    // Set timeout to remove user after TYPING_TIMEOUT_MS
    if (!timeouts.current[channelId]) {
      timeouts.current[channelId] = {};
    }
    timeouts.current[channelId][userId] = setTimeout(() => {
      clearTypingUser(channelId, userId);
    }, TYPING_TIMEOUT_MS);
  }

  function clearTypingUser(channelId: string, userId?: string | null) {
    if (!userId) return;
    const timeouts = dmTypingTimeouts;
    const setter = setTypingInDm;

    if (timeouts.current[channelId]?.[userId]) {
      clearTimeout(timeouts.current[channelId][userId]);
      delete timeouts.current[channelId][userId];
    }

    setter((prev) => {
      const current = prev[channelId];
      if (!current) return prev;
      const filtered = current.filter((id) => id !== userId);
      if (filtered.length === 0) {
        const { [channelId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [channelId]: filtered };
    });
  }

  const joinDm = useCallback(
    (conversationId: string) => {
      if (!socket || !isConnected) return;
      socket.emit("join:dm", conversationId);
    },
    [socket, isConnected],
  );

  const leaveDm = useCallback(
    (conversationId: string) => {
      if (!socket || !isConnected) return;
      socket.emit("leave:dm", conversationId);
    },
    [socket, isConnected],
  );

  const emitTypingDm = useCallback(
    (conversationId: string) => {
      if (!socket || !isConnected) return;
      const key = `dm:${conversationId}`;
      const now = Date.now();
      if (now - (lastTypingEmit.current[key] || 0) < TYPING_THROTTLE_MS) return;
      lastTypingEmit.current[key] = now;
      socket.emit("typing:dm", conversationId);
    },
    [socket, isConnected],
  );

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        joinDm,
        leaveDm,
        emitTypingDm,
        typingInDm,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
}
