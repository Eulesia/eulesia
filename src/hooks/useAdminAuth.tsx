import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { API_BASE_URL } from "../lib/runtimeConfig";

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  name: string;
}

interface AdminAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  admin: AdminUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(
  undefined,
);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [admin, setAdmin] = useState<AdminUser | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/admin/auth/me`, {
        credentials: "include",
      });
      if (!response.ok) {
        setAdmin(null);
        setIsAuthenticated(false);
        return;
      }
      const data = await response.json();
      if (data.success && data.data) {
        setAdmin(data.data);
        setIsAuthenticated(true);
      } else {
        setAdmin(null);
        setIsAuthenticated(false);
      }
    } catch {
      setAdmin(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (username: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/api/v1/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Login failed");
    }
    setAdmin(data.data);
    setIsAuthenticated(true);
  };

  const logout = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/admin/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore logout errors
    } finally {
      setAdmin(null);
      setIsAuthenticated(false);
    }
  };

  return (
    <AdminAuthContext.Provider
      value={{ isAuthenticated, isLoading, admin, login, logout }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (context === undefined) {
    throw new Error("useAdminAuth must be used within an AdminAuthProvider");
  }
  return context;
}
