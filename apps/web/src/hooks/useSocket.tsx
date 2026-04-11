import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { API_BASE_URL } from "../lib/runtimeConfig";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Server-sent messages (must match crates/ws/src/messages.rs ServerMessage). */
type ServerMessage =
  | {
      type: "new_message";
      conversation_id: string;
      message_id: string;
      sender_id: string;
      ciphertext: string;
      epoch: number;
    }
  | {
      type: "notification";
      id: string;
      event_type: string;
      title: string;
      body: string | null;
      link: string | null;
    }
  | {
      type: "typing";
      conversation_id: string;
      user_id: string;
      is_typing: boolean;
    }
  | {
      type: "presence";
      user_id: string;
      online: boolean;
    };

/** Client-sent messages (must match crates/ws/src/messages.rs ClientMessage). */
type ClientMessage =
  | { type: "ping" }
  | { type: "typing_start"; conversation_id: string }
  | { type: "typing_stop"; conversation_id: string };

interface SocketContextType {
  /** Whether the WebSocket is currently connected. */
  isConnected: boolean;
  /** Start observing a conversation (currently triggers mark-read logic). */
  joinDm: (conversationId: string) => void;
  /** Stop observing a conversation. */
  leaveDm: (conversationId: string) => void;
  /** Send a typing indicator for a conversation. */
  emitTypingDm: (conversationId: string) => void;
  /** Map of conversationId -> list of user IDs currently typing. */
  typingInDm: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SocketContext = createContext<SocketContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum delay between reconnect attempts (ms). */
const RECONNECT_BASE_MS = 1_000;
/** Maximum delay between reconnect attempts (ms). */
const RECONNECT_MAX_MS = 30_000;
/** Interval between keepalive pings (ms). */
const PING_INTERVAL_MS = 25_000;
/** How long a typing indicator stays visible without refresh (ms). */
const TYPING_TIMEOUT_MS = 4_000;
/** Minimum interval between emitting typing_start for the same conversation. */
const TYPING_THROTTLE_MS = 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildWsUrl(): string {
  // Derive WS URL from the API base. In production API_BASE_URL is "" (same
  // origin), in dev it's "http://localhost:3001".
  let base = API_BASE_URL;
  if (!base) {
    // Same-origin: derive from window.location
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    base = `${proto}//${window.location.host}`;
  } else {
    base = base.replace(/^http/, "ws");
  }
  return `${base}/ws/v2`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [isConnected, setIsConnected] = useState(false);
  const [typingInDm, setTypingInDm] = useState<Record<string, string[]>>({});

  // Refs that persist across renders
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const typingThrottleRef = useRef<Record<string, number>>({});
  // Track intentional close to prevent reconnect
  const intentionalCloseRef = useRef(false);

  // -----------------------------------------------------------------------
  // Typing indicator management
  // -----------------------------------------------------------------------

  const addTypingUser = useCallback(
    (conversationId: string, userId: string) => {
      setTypingInDm((prev) => {
        const current = prev[conversationId] ?? [];
        if (current.includes(userId)) return prev;
        return { ...prev, [conversationId]: [...current, userId] };
      });

      // Auto-clear after timeout
      const key = `${conversationId}:${userId}`;
      if (typingTimersRef.current[key]) {
        clearTimeout(typingTimersRef.current[key]);
      }
      typingTimersRef.current[key] = setTimeout(() => {
        setTypingInDm((prev) => {
          const current = prev[conversationId] ?? [];
          const filtered = current.filter((id) => id !== userId);
          if (filtered.length === current.length) return prev;
          return { ...prev, [conversationId]: filtered };
        });
        delete typingTimersRef.current[key];
      }, TYPING_TIMEOUT_MS);
    },
    [],
  );

  const removeTypingUser = useCallback(
    (conversationId: string, userId: string) => {
      const key = `${conversationId}:${userId}`;
      if (typingTimersRef.current[key]) {
        clearTimeout(typingTimersRef.current[key]);
        delete typingTimersRef.current[key];
      }
      setTypingInDm((prev) => {
        const current = prev[conversationId] ?? [];
        const filtered = current.filter((id) => id !== userId);
        if (filtered.length === current.length) return prev;
        return { ...prev, [conversationId]: filtered };
      });
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Send helper
  // -----------------------------------------------------------------------

  const wsSend = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // -----------------------------------------------------------------------
  // WebSocket lifecycle
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!isAuthenticated) {
      // Close any existing connection on logout
      intentionalCloseRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      setIsConnected(false);
      setTypingInDm({});
      return;
    }

    intentionalCloseRef.current = false;

    function connect() {
      if (intentionalCloseRef.current) return;

      const url = buildWsUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setIsConnected(true);

        // Start keepalive pings
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case "new_message": {
            // Invalidate both DM and group conversation queries.
            queryClient.invalidateQueries({
              queryKey: ["conversation", msg.conversation_id],
            });
            queryClient.invalidateQueries({
              queryKey: ["groupConversation", msg.conversation_id],
            });
            // Also invalidate the conversations list (for unread badges, last message preview).
            queryClient.invalidateQueries({
              queryKey: ["conversations"],
            });
            // Invalidate unread count (must match queryKeys.dmUnreadCount)
            queryClient.invalidateQueries({
              queryKey: ["dmUnreadCount"],
            });
            // Clear typing indicator for this sender in this conversation
            removeTypingUser(msg.conversation_id, msg.sender_id);
            break;
          }

          case "notification": {
            // Invalidate notifications query
            queryClient.invalidateQueries({
              queryKey: ["notifications"],
            });
            break;
          }

          case "typing": {
            if (msg.is_typing) {
              addTypingUser(msg.conversation_id, msg.user_id);
            } else {
              removeTypingUser(msg.conversation_id, msg.user_id);
            }
            break;
          }

          case "presence": {
            // Presence updates can be consumed by components via context
            // expansion later. For now, just invalidate relevant queries.
            break;
          }
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }

        // Reconnect with exponential backoff unless intentionally closed
        if (!intentionalCloseRef.current) {
          const attempt = reconnectAttemptRef.current;
          const delay = Math.min(
            RECONNECT_BASE_MS * 2 ** attempt,
            RECONNECT_MAX_MS,
          );
          reconnectAttemptRef.current = attempt + 1;
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        // onerror is always followed by onclose — reconnect logic lives there
      };
    }

    connect();

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      setIsConnected(false);
    };
  }, [isAuthenticated, queryClient, addTypingUser, removeTypingUser]);

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  const joinDm = useCallback((_conversationId: string) => {
    // Currently a no-op — reserved for future join signalling.
  }, []);

  const leaveDm = useCallback((conversationId: string) => {
    // Clear typing state for this conversation
    setTypingInDm((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, []);

  const emitTypingDm = useCallback(
    (conversationId: string) => {
      const now = Date.now();
      const last = typingThrottleRef.current[conversationId] ?? 0;
      if (now - last < TYPING_THROTTLE_MS) return;
      typingThrottleRef.current[conversationId] = now;
      wsSend({ type: "typing_start", conversation_id: conversationId });
    },
    [wsSend],
  );

  return (
    <SocketContext.Provider
      value={{
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSocket() {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
}
