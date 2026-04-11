/**
 * @module useDevice
 *
 * React hook and context provider for E2EE device state.
 *
 * The DeviceProvider watches authentication state and automatically
 * initializes the device's cryptographic identity when the user is
 * authenticated. Logging out only resets in-memory session state; the local
 * device identity persists until the user explicitly revokes the device.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./useAuth.tsx";
import { api } from "../lib/api.ts";
import { initializeDevice, inspectDeviceSetup } from "../lib/e2ee/index.ts";
import {
  clearAllPlaintext,
  clearLegacyDmPlaintextCache,
  initPlaintextCache,
} from "../lib/e2ee/dmPlaintextCache.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceContextType {
  /** The registered device ID, or null if not yet initialized. */
  deviceId: string | null;
  /** Whether the device has been successfully initialized. */
  isInitialized: boolean;
  /** Whether device initialization is currently in progress. */
  isInitializing: boolean;
  /** Whether this browser needs explicit trust before creating its first device. */
  requiresTrust: boolean;
  /** Whether this browser needs a pairing code from another active device. */
  requiresPairing: boolean;
  /** Error message if device initialization failed, or null. */
  error: string | null;
  /** Retry or manually trigger device initialization for this browser. */
  initializeCurrentDevice: (pairingCode?: string) => Promise<void>;
  /** Whether this session just registered a new device. */
  hasFreshRegistration: boolean;
  /** Dismiss the post-registration notice. */
  dismissFreshRegistration: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const DeviceContext = createContext<DeviceContextType | undefined>(undefined);

function isPairingRequiredError(message: string): boolean {
  return message.includes("pairing_code is required");
}

function isPairingFlowError(message: string): boolean {
  return message.includes("pairing code") || message.includes("pairing_code");
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DeviceProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common");
  const { isAuthenticated, currentUser } = useAuth();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [requiresTrust, setRequiresTrust] = useState(false);
  const [requiresPairing, setRequiresPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAttemptedInit, setHasAttemptedInit] = useState(false);
  const [hasFreshRegistration, setHasFreshRegistration] = useState(false);

  // Track the previous auth state to detect logout transitions
  const prevAuthRef = useRef(false);

  const completeInitialization = useCallback(
    async (
      userId: string,
      registration: { deviceId: string },
      freshRegistration: boolean,
    ) => {
      const { initializeMatrixCryptoMachine, syncMatrixMachine } = await import(
        "../lib/e2ee/index.ts"
      );
      await initializeMatrixCryptoMachine(userId, registration.deviceId);
      await syncMatrixMachine(api, registration.deviceId);

      // Scope the plaintext cache to this user/device pair.
      initPlaintextCache(userId, registration.deviceId);

      setDeviceId(registration.deviceId);
      setIsInitialized(true);
      setHasFreshRegistration(freshRegistration);
    },
    [],
  );

  const initialize = useCallback(
    async (pairingCode?: string) => {
      setHasAttemptedInit(true);
      setIsInitializing(true);
      setError(null);
      setRequiresTrust(false);
      setRequiresPairing(false);

      try {
        if (!currentUser) {
          throw new Error(
            "Cannot initialize device without an authenticated user",
          );
        }

        // Purge any plaintext DM entries left by the pre-sessionStorage
        // cache so cleartext is never persisted across sessions.
        clearLegacyDmPlaintextCache();

        const registration = await initializeDevice(
          api,
          currentUser.id,
          pairingCode,
        );

        await completeInitialization(
          currentUser.id,
          registration,
          registration.didCreateDevice,
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Device initialization failed";
        if (isPairingRequiredError(message)) {
          setError(null);
          setRequiresPairing(true);
        } else {
          console.error("Device initialization failed:", err);
          setError(message);
          setRequiresPairing(isPairingFlowError(message));
        }
        setHasFreshRegistration(false);
      } finally {
        setIsInitializing(false);
      }
    },
    [completeInitialization, currentUser],
  );

  const inspect = useCallback(async () => {
    setHasAttemptedInit(true);
    setIsInitializing(true);
    setError(null);
    setRequiresTrust(false);
    setRequiresPairing(false);

    try {
      if (!currentUser) {
        throw new Error(
          "Cannot initialize device without an authenticated user",
        );
      }

      clearLegacyDmPlaintextCache();

      const requirement = await inspectDeviceSetup(api, currentUser.id);
      if (requirement.status === "needs-trust") {
        setRequiresTrust(true);
        setDeviceId(null);
        setIsInitialized(false);
        return;
      }

      if (requirement.status === "needs-pairing") {
        setRequiresPairing(true);
        setDeviceId(null);
        setIsInitialized(false);
        return;
      }

      const registration = await initializeDevice(api, currentUser.id);
      await completeInitialization(currentUser.id, registration, false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Device initialization failed";
      console.error("Device inspection failed:", err);
      setError(message);
    } finally {
      setIsInitializing(false);
    }
  }, [completeInitialization, currentUser]);

  // Initialize device when authenticated
  useEffect(() => {
    if (
      isAuthenticated &&
      !isInitialized &&
      !isInitializing &&
      currentUser &&
      !hasAttemptedInit
    ) {
      void inspect();
    }
  }, [
    currentUser,
    hasAttemptedInit,
    inspect,
    isAuthenticated,
    isInitialized,
    isInitializing,
  ]);

  // Reset in-memory device state on logout. The persisted key store remains
  // intact so the browser keeps the same cryptographic identity across
  // session logouts.
  useEffect(() => {
    if (prevAuthRef.current && !isAuthenticated) {
      void import("../lib/e2ee/matrixCrypto.ts").then(
        ({ closeMatrixCryptoMachine }) => closeMatrixCryptoMachine(),
      );
      void clearAllPlaintext();

      setDeviceId(null);
      setIsInitialized(false);
      setRequiresTrust(false);
      setRequiresPairing(false);
      setError(null);
      setHasAttemptedInit(false);
      setHasFreshRegistration(false);
    }
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated]);

  return (
    <DeviceContext.Provider
      value={{
        deviceId,
        isInitialized,
        isInitializing,
        requiresTrust,
        requiresPairing,
        error,
        initializeCurrentDevice: initialize,
        hasFreshRegistration,
        dismissFreshRegistration: () => setHasFreshRegistration(false),
      }}
    >
      {children}
      {hasFreshRegistration && (
        <div className="pointer-events-none fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm">
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto rounded-2xl border border-emerald-200 bg-white/95 p-4 shadow-xl backdrop-blur dark:border-emerald-900 dark:bg-gray-900/95"
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("e2ee.deviceReadyTitle")}
            </p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {t("e2ee.deviceReadyBody")}
            </p>
            <button
              type="button"
              onClick={() => setHasFreshRegistration(false)}
              className="mt-3 inline-flex items-center rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              {t("actions.close")}
            </button>
          </div>
        </div>
      )}
    </DeviceContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDevice(): DeviceContextType {
  const context = useContext(DeviceContext);
  if (context === undefined) {
    throw new Error("useDevice must be used within a DeviceProvider");
  }
  return context;
}
