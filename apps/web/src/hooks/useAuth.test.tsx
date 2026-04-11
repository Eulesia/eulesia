import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { AuthProvider, useAuth } from "./useAuth";
import { api } from "../lib/api";
import type { User } from "../lib/api";

// Mock the api module
vi.mock("../lib/api", () => ({
  api: {
    getCurrentUser: vi.fn(),
    requestMagicLink: vi.fn(),
    logout: vi.fn(),
    revokeDevice: vi.fn(),
    updateProfile: vi.fn().mockResolvedValue({}),
  },
  setUnauthorizedHandler: vi.fn(),
}));

const mockUser: User = {
  id: "1",
  email: "test@example.com",
  name: "Test User",
  role: "citizen",
  identityVerified: true,
  identityLevel: "substantial",
  createdAt: new Date().toISOString(),
};

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(AuthProvider, null, children),
    );
};

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error when used outside AuthProvider", () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useAuth());
    }).toThrow("useAuth must be used within an AuthProvider");

    consoleSpy.mockRestore();
  });

  it("starts in loading state", () => {
    vi.mocked(api.getCurrentUser).mockImplementation(
      () => new Promise(() => {}),
    );

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("sets authenticated state when user is found", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValueOnce(mockUser);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.currentUser).toEqual(mockUser);
  });

  it("sets unauthenticated state when no user", async () => {
    vi.mocked(api.getCurrentUser).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.currentUser).toBeNull();
  });

  it("can request magic link", async () => {
    vi.mocked(api.getCurrentUser).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    vi.mocked(api.requestMagicLink).mockResolvedValueOnce({
      message: "Link sent",
    });

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const response = await result.current.requestMagicLink("test@example.com");

    expect(api.requestMagicLink).toHaveBeenCalledWith("test@example.com");
    expect(response).toEqual({ message: "Link sent" });
  });

  it("can logout", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValueOnce(mockUser);
    vi.mocked(api.logout).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(api.logout).toHaveBeenCalled();
    expect(api.revokeDevice).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.currentUser).toBeNull();
  });
});
