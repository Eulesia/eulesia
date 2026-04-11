import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import {
  loadConversationTargetDevices,
  useSendDM,
  useThreads,
  useTags,
  useClubs,
} from "./useApi";

const makeDevice = (id: string) => ({
  id,
  platform: "web",
  createdAt: new Date(0).toISOString(),
});

// Helper: create a mock Response with Content-Type: application/json
const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 400,
  headers: {
    get: (key: string) => (key === "content-type" ? "application/json" : null),
  },
  json: () => Promise.resolve(body),
});

// Create a fresh query client for each test
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

// Wrapper component for React Query
const createWrapper = () => {
  const queryClient = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
};

describe("useApi hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useThreads", () => {
    it("should fetch threads successfully", async () => {
      const mockThreads = {
        items: [
          {
            id: "1",
            title: "Test Thread",
            content: "Test content",
            scope: "municipal" as const,
            tags: ["test"],
            author: {
              id: "user1",
              name: "Test User",
              role: "citizen" as const,
            },
            replyCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        hasMore: false,
      };

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ success: true, data: mockThreads }),
        );

      const { result } = renderHook(() => useThreads(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockThreads);
    });

    it("should handle API errors", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ success: false, error: "Server error" }, false),
        );

      const { result } = renderHook(() => useThreads(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it("should pass filters to API", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { items: [], total: 0, page: 1, limit: 20, hasMore: false },
        }),
      );

      renderHook(() => useThreads({ scope: "national", tags: ["climate"] }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining("scope=national"),
          expect.any(Object),
        );
      });
    });
  });

  describe("useTags", () => {
    it("should fetch tags successfully", async () => {
      const mockTags = [
        { tag: "climate", count: 10 },
        { tag: "urban-planning", count: 5 },
      ];

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ success: true, data: mockTags }));

      const { result } = renderHook(() => useTags(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockTags);
    });
  });

  describe("useClubs", () => {
    it("should fetch clubs successfully", async () => {
      const mockClubs = {
        items: [
          {
            id: "1",
            name: "Test Club",
            slug: "test-club",
            description: "A test club",
            memberCount: 10,
            creator: { id: "user1", name: "Creator", role: "citizen" as const },
            isMember: false,
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        hasMore: false,
      };

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ success: true, data: mockClubs }),
        );

      const { result } = renderHook(() => useClubs(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockClubs);
    });

    it("should filter clubs by category", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { items: [], total: 0, page: 1, limit: 20, hasMore: false },
        }),
      );

      renderHook(() => useClubs({ category: "Sports" }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining("category=Sports"),
          expect.any(Object),
        );
      });
    });
  });

  describe("loadConversationTargetDevices", () => {
    it("includes the sender's own devices and de-duplicates shared IDs", async () => {
      const client: NonNullable<
        Parameters<typeof loadConversationTargetDevices>[2]
      > = {
        listDevices: vi
          .fn()
          .mockResolvedValue([
            makeDevice("self-device"),
            makeDevice("shared-device"),
          ]),
        getUserDevices: vi
          .fn()
          .mockResolvedValue([
            makeDevice("shared-device"),
            makeDevice("peer-device"),
          ]),
      };

      const devices = await loadConversationTargetDevices(
        ["me", "peer", "me"],
        "me",
        client,
      );

      expect(client.listDevices).toHaveBeenCalledTimes(1);
      expect(client.getUserDevices).toHaveBeenCalledWith("peer");
      expect(devices).toEqual([
        { deviceId: "self-device", userId: "me" },
        { deviceId: "shared-device", userId: "me" },
        { deviceId: "peer-device", userId: "peer" },
      ]);
    });
  });

  describe("useSendDM", () => {
    it("keeps plaintext conversations on the plaintext send path", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            id: "msg-1",
            conversationId: "conv-1",
            senderId: "user-1",
            senderDeviceId: null,
            epoch: 0,
            ciphertext: "",
            content: "hello world",
            messageType: "text",
            serverTs: new Date(0).toISOString(),
          },
        }),
      );

      const { result } = renderHook(
        () =>
          useSendDM("conv-1", {
            encryption: "none",
            deviceId: null,
            userId: "user-1",
            otherUserId: "user-2",
          }),
        {
          wrapper: createWrapper(),
        },
      );

      await act(async () => {
        await result.current.mutateAsync("hello world");
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/conversations/conv-1/messages"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ content: "hello world" }),
        }),
      );
    });
  });
});
