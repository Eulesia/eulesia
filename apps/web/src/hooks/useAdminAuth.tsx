import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  name: string;
}

type AuthStep = "idle" | "totp_required" | "setup_required" | "authenticated";

interface AdminAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  authStep: AuthStep;
  admin: AdminUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  verifyTotp: (code: string) => Promise<void>;
  loginWithRecovery: (code: string) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  verifyPasskey: () => Promise<void>;
  beginPasskeyRegistration: (
    name: string,
  ) => Promise<{ recoveryCodes: string[] | null }>;
  beginTotpSetup: () => Promise<{ secret: string; qrUri: string }>;
  confirmTotpSetup: (code: string) => Promise<{ recoveryCodes: string[] }>;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(
  undefined,
);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const isAdminPath = window.location.pathname.startsWith("/admin");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(isAdminPath);
  const [authStep, setAuthStep] = useState<AuthStep>("idle");
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [checked, setChecked] = useState(false);

  const checkAuth = useCallback(async () => {
    if (checked) return;
    setIsLoading(true);
    try {
      const data = await api.adminMe();
      setAdmin(data);
      setIsAuthenticated(true);
      setAuthStep("authenticated");
    } catch {
      setAdmin(null);
      setIsAuthenticated(false);
      setAuthStep("idle");
    } finally {
      setIsLoading(false);
      setChecked(true);
    }
  }, [checked]);

  useEffect(() => {
    if (window.location.pathname.startsWith("/admin")) {
      checkAuth();
    }
  }, [checkAuth]);

  const login = async (username: string, password: string) => {
    const data = await api.adminLogin(username, password);
    if (data.status === "totp_required") {
      setAuthStep("totp_required");
    } else if (data.status === "setup_required") {
      setAuthStep("setup_required");
    }
  };

  const verifyTotp = async (code: string) => {
    const data = await api.adminTotpVerify(code);
    setAdmin(data);
    setIsAuthenticated(true);
    setAuthStep("authenticated");
    setChecked(true);
  };

  const loginWithRecovery = async (code: string) => {
    const data = await api.adminTotpRecovery(code);
    setAdmin(data);
    setIsAuthenticated(true);
    setAuthStep("authenticated");
    setChecked(true);
  };

  const loginWithPasskey = async () => {
    const options = await api.adminPasskeyAuthBegin();
    const credential = await startAuthentication({ optionsJSON: options });
    const data = await api.adminPasskeyAuthFinish(credential);
    setAdmin(data);
    setIsAuthenticated(true);
    setAuthStep("authenticated");
    setChecked(true);
  };

  const verifyPasskey = async () => {
    const options = await api.adminPasskeyAuthBegin();
    const credential = await startAuthentication({ optionsJSON: options });
    const data = await api.adminPasskeyAuthFinish(credential);
    setAdmin(data);
    setIsAuthenticated(true);
    setAuthStep("authenticated");
    setChecked(true);
  };

  const beginPasskeyRegistration = async (name: string) => {
    const options = await api.adminPasskeyRegisterBegin();
    const credential = await startRegistration({ optionsJSON: options });
    const result = await api.adminPasskeyRegisterFinish(credential, name);
    if (result.profile) {
      setAdmin(result.profile);
      setIsAuthenticated(true);
      setAuthStep("authenticated");
      setChecked(true);
    }
    return { recoveryCodes: result.recoveryCodes };
  };

  const beginTotpSetup = async () => {
    return api.adminTotpSetupBegin();
  };

  const confirmTotpSetup = async (code: string) => {
    const result = await api.adminTotpSetupConfirm(code);
    setAdmin(result.profile);
    setIsAuthenticated(true);
    setAuthStep("authenticated");
    setChecked(true);
    return { recoveryCodes: result.recoveryCodes };
  };

  const logout = async () => {
    try {
      await api.adminLogout();
    } catch {
      // Ignore logout errors
    } finally {
      setAdmin(null);
      setIsAuthenticated(false);
      setAuthStep("idle");
      setChecked(false);
    }
  };

  return (
    <AdminAuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        authStep,
        admin,
        login,
        logout,
        verifyTotp,
        loginWithRecovery,
        loginWithPasskey,
        verifyPasskey,
        beginPasskeyRegistration,
        beginTotpSetup,
        confirmTotpSetup,
      }}
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
