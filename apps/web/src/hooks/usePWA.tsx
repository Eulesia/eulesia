import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  type ReactNode,
} from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PWAContextType {
  needRefresh: boolean;
  updateServiceWorker: () => void;
  offlineReady: boolean;
  canInstall: boolean;
  installApp: () => Promise<void>;
}

const PWAContext = createContext<PWAContextType>({
  needRefresh: false,
  updateServiceWorker: () => {},
  offlineReady: false,
  canInstall: false,
  installApp: async () => {},
});

const LEGACY_CACHE_PREFIXES = ["workbox-", "eulesia-"];

function getRegistrationScriptUrls(
  registration: ServiceWorkerRegistration,
): string[] {
  return [
    registration.active?.scriptURL,
    registration.installing?.scriptURL,
    registration.waiting?.scriptURL,
  ].filter((value): value is string => Boolean(value));
}

async function cleanupLegacyServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();

  await Promise.all(
    registrations.map(async (registration) => {
      const shouldRemove = getRegistrationScriptUrls(registration).some(
        (scriptUrl) => {
          try {
            return new URL(scriptUrl).pathname === "/sw.js";
          } catch {
            return scriptUrl.endsWith("/sw.js");
          }
        },
      );

      if (shouldRemove) {
        await registration.unregister();
      }
    }),
  );

  if (!("caches" in window)) {
    return;
  }

  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((cacheName) =>
        LEGACY_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix)),
      )
      .map((cacheName) => caches.delete(cacheName)),
  );
}

export function PWAProvider({ children }: { children: ReactNode }) {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    async function cleanupWorkers() {
      if (!("serviceWorker" in navigator)) {
        return;
      }

      try {
        await cleanupLegacyServiceWorkers();
      } catch {
        // Legacy service worker cleanup is best effort.
      }
    }

    void cleanupWorkers();
  }, []);

  const updateServiceWorker = useCallback(() => {
    window.location.reload();
  }, []);

  const installApp = useCallback(async () => {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallPrompt(null);
    }
  }, [installPrompt]);

  return (
    <PWAContext.Provider
      value={{
        needRefresh: false,
        updateServiceWorker,
        offlineReady: false,
        canInstall: !!installPrompt,
        installApp,
      }}
    >
      {children}
    </PWAContext.Provider>
  );
}

export function usePWA() {
  return useContext(PWAContext);
}
