import { useState, useEffect, useRef, useCallback } from "react";
import {
  Shield,
  Bell,
  BellRing,
  Eye,
  Database,
  LogOut,
  ChevronRight,
  Info,
  ExternalLink,
  Camera,
  Loader2,
  Globe,
  HelpCircle,
  AlertTriangle,
  Trash2,
  Sun,
  Moon,
  Monitor,
  Lock,
  Smartphone,
  Laptop,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { LanguageSwitcher } from "../components/common/LanguageSwitcher";
import { AppealButton } from "../components/common/AppealButton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../hooks/useAuth";
import { useDevice } from "../hooks/useDevice";
import { useTheme } from "../hooks/useTheme";
import { useMySanctions } from "../hooks/useAdminApi";
import { useGuide } from "../hooks/useGuide";
import {
  useUpdateProfile,
  useExportData,
  useDeleteAccount,
} from "../hooks/useApi";
import { guides } from "../data/guides";
import { api, type User } from "../lib/api";

type CapacitorWindow = Window & {
  Capacitor?: {
    isNativePlatform?: () => boolean;
  };
};

const DEVICE_LIMIT = 10;
const PUSH_SERVICE_WORKER_PATH = "/sw-push.js";

function getDeviceIcon(platform: string) {
  return platform === "android" || platform === "ios" ? Smartphone : Laptop;
}

function formatDeviceTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getRegistrationScriptUrls(
  registration: ServiceWorkerRegistration,
): string[] {
  return [
    registration.active?.scriptURL,
    registration.installing?.scriptURL,
    registration.waiting?.scriptURL,
  ].filter((value): value is string => Boolean(value));
}

function isPushServiceWorker(registration: ServiceWorkerRegistration): boolean {
  return getRegistrationScriptUrls(registration).some((scriptUrl) => {
    try {
      return new URL(scriptUrl).pathname === PUSH_SERVICE_WORKER_PATH;
    } catch {
      return scriptUrl.endsWith(PUSH_SERVICE_WORKER_PATH);
    }
  });
}

async function getPushServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  return registrations.find(isPushServiceWorker) ?? null;
}

async function ensurePushServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await getPushServiceWorkerRegistration();
  if (existing) {
    return existing;
  }

  const registration = await navigator.serviceWorker.register(
    PUSH_SERVICE_WORKER_PATH,
    { scope: "/" },
  );

  if (registration.active) {
    return registration;
  }

  const worker = registration.installing ?? registration.waiting;
  if (!worker) {
    return registration;
  }

  await new Promise<void>((resolve, reject) => {
    const handleStateChange = () => {
      if (worker.state === "activated") {
        resolve();
        return;
      }

      if (worker.state === "redundant") {
        reject(new Error("Push service worker activation failed"));
      }
    };

    worker.addEventListener("statechange", handleStateChange);
    handleStateChange();
  });

  return registration;
}

export function ProfilePage() {
  const { t } = useTranslation(["profile", "common", "auth"]);
  const { currentUser, logout, refreshUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const { data: mySanctions } = useMySanctions();
  const navigate = useNavigate();
  const updateProfileMutation = useUpdateProfile();
  const exportDataMutation = useExportData();
  const deleteAccountMutation = useDeleteAccount();
  // Institution Management - disabled temporarily
  // const { data: myInstitutions } = useMyInstitutions()
  // const [showAvailableInstitutions, setShowAvailableInstitutions] = useState(false)
  // const { data: availableInstitutions } = useAvailableInstitutions()
  // const claimInstitutionMutation = useClaimInstitution()
  // const createOrgMutation = useCreateOrganization()
  // const [showCreateOrg, setShowCreateOrg] = useState(false)
  // const [orgForm, setOrgForm] = useState({ name: '', institutionName: '', businessId: '', businessIdCountry: 'FI', websiteUrl: '', description: '' })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentUser?.name || "");
  const { startGuide, hasCompletedGuide, resetAllGuides } = useGuide();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [notificationSettings, setNotificationSettings] = useState({
    replies: currentUser?.settings?.notificationReplies ?? true,
    mentions: currentUser?.settings?.notificationMentions ?? true,
    official: currentUser?.settings?.notificationOfficial ?? true,
  });

  // Push notification state
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  const capacitor =
    typeof window !== "undefined"
      ? (window as CapacitorWindow).Capacitor
      : undefined;
  const isNative = !!capacitor?.isNativePlatform?.();

  const checkPushStatus = useCallback(async () => {
    if (isNative) {
      // Native: check Capacitor push permission
      setPushSupported(true);
      try {
        const { PushNotifications } = await import(
          "@capacitor/push-notifications"
        );
        const permission = await PushNotifications.checkPermissions();
        setPushEnabled(permission.receive === "granted");
      } catch {
        /* ignore */
      }
    } else {
      // Web: check service worker + PushManager
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      setPushSupported(true);
      try {
        const reg = await getPushServiceWorkerRegistration();
        if (!reg) {
          setPushEnabled(false);
          return;
        }
        const sub = await reg.pushManager.getSubscription();
        setPushEnabled(!!sub);
      } catch {
        /* ignore */
      }
    }
  }, [isNative]);

  useEffect(() => {
    checkPushStatus();
  }, [checkPushStatus]);

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
    }
  }, [editingName]);

  const handlePushToggle = async () => {
    setPushLoading(true);
    try {
      if (isNative) {
        if (pushEnabled) {
          // On native, can't programmatically revoke permission — unregister token from server
          const token = localStorage.getItem("fcm_token");
          if (token) {
            await api.unregisterDeviceToken(token);
            localStorage.removeItem("fcm_token");
          }
          setPushEnabled(false);
        } else {
          const { PushNotifications } = await import(
            "@capacitor/push-notifications"
          );
          const permission = await PushNotifications.requestPermissions();
          if (permission.receive === "granted") {
            await PushNotifications.register();
            setPushEnabled(true);
          }
        }
      } else {
        if (pushEnabled) {
          // Unsubscribe
          const reg = await getPushServiceWorkerRegistration();
          if (!reg) {
            setPushEnabled(false);
            return;
          }
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            await api.unsubscribePush(sub.endpoint);
            await sub.unsubscribe();
          }
          setPushEnabled(false);
        } else {
          // Subscribe
          const { vapidPublicKey, enabled } = await api.getPushVapidKey();
          if (!enabled || !vapidPublicKey) return;
          const reg = await ensurePushServiceWorkerRegistration();
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidPublicKey,
          });
          await api.subscribePush(sub);
          setPushEnabled(true);
        }
      }
    } catch (err) {
      console.error("Push toggle failed:", err);
    } finally {
      setPushLoading(false);
    }
  };

  // Avatar upload state
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const handleNotificationChange = async (
    key: keyof typeof notificationSettings,
  ) => {
    const newValue = !notificationSettings[key];
    setNotificationSettings((prev) => ({ ...prev, [key]: newValue }));

    const settingsKeyMap = {
      replies: "notificationReplies",
      mentions: "notificationMentions",
      official: "notificationOfficial",
    } as const;

    try {
      await updateProfileMutation.mutateAsync({
        settings: {
          ...currentUser?.settings,
          [settingsKeyMap[key]]: newValue,
        },
      } as Parameters<typeof updateProfileMutation.mutateAsync>[0]);
    } catch (err) {
      // Revert on error
      setNotificationSettings((prev) => ({ ...prev, [key]: !newValue }));
      console.error("Failed to update notification settings:", err);
    }
  };

  const handleExportData = async () => {
    try {
      const data = await exportDataMutation.mutateAsync();
      // Download as JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "eulesia-my-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export data:", err);
    }
  };

  const handleSaveDisplayName = () => {
    const profileUpdate: Partial<User> = { name: nameInput };
    updateProfileMutation.mutate(profileUpdate, {
      onSuccess: () => {
        void refreshUser();
        setEditingName(false);
      },
    });
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setAvatarError(t("avatar.allowedFormats"));
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError(t("avatar.maxSize"));
      return;
    }

    setIsUploadingAvatar(true);
    setAvatarError(null);

    try {
      await api.uploadAvatar(file);
      // Refresh user to get new avatar URL
      await refreshUser();
    } catch (err) {
      setAvatarError(t("avatar.uploadFailed"));
      console.error("Avatar upload failed:", err);
    } finally {
      setIsUploadingAvatar(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveAvatar = async () => {
    setIsUploadingAvatar(true);
    setAvatarError(null);

    try {
      await api.deleteAvatar();
      await refreshUser();
    } catch (err) {
      setAvatarError(t("avatar.removeFailed"));
      console.error("Avatar delete failed:", err);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  if (!currentUser) {
    return (
      <Layout>
        <div className="p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            {t("auth:pleaseLogin")}
          </p>
        </div>
      </Layout>
    );
  }

  const avatarInitials = currentUser.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Layout>
      <SEOHead title={t("profile:title")} path="/profile" noIndex />
      {/* Active sanctions */}
      {mySanctions && mySanctions.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-4">
          <div className="flex items-center gap-2 text-red-800 dark:text-red-300 font-medium mb-2">
            <AlertTriangle className="w-4 h-4" />
            {t("profile:sanctions.active")}
          </div>
          {mySanctions
            .filter((s) => !s.revokedAt)
            .map((s) => (
              <div
                key={s.id}
                className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-red-200 dark:border-red-800 mb-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-red-800 dark:text-red-300 capitalize">
                    {s.sanctionType}
                  </span>
                  {s.expiresAt && (
                    <span className="text-xs text-red-600">
                      {t("profile:sanctions.expiresAt", {
                        date: new Date(s.expiresAt).toLocaleDateString(),
                      })}
                    </span>
                  )}
                </div>
                {s.reason && (
                  <p className="text-xs text-red-700 mt-1">{s.reason}</p>
                )}
                <div className="mt-2">
                  <AppealButton sanctionId={s.id} />
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Profile header */}
      <div className="bg-white dark:bg-gray-900 px-4 py-6 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-4">
          {/* Avatar with upload */}
          <div className="relative">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleAvatarUpload}
              className="hidden"
            />
            <button
              onClick={handleAvatarClick}
              disabled={isUploadingAvatar}
              className="w-16 h-16 bg-teal-600 rounded-full flex items-center justify-center relative group overflow-hidden disabled:cursor-not-allowed"
            >
              {currentUser.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt=""
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <span className="text-white text-xl font-bold">
                  {avatarInitials}
                </span>
              )}
              {/* Overlay */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full">
                {isUploadingAvatar ? (
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                ) : (
                  <Camera className="w-6 h-6 text-white" />
                )}
              </div>
            </button>
            {/* Remove avatar button */}
            {currentUser.avatarUrl && !isUploadingAvatar && (
              <button
                onClick={handleRemoveAvatar}
                className="absolute -bottom-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors shadow-sm"
                title={t("avatar.removeTitle")}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
          <div>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  ref={nameInputRef}
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="text-lg font-bold px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSaveDisplayName();
                    }
                    if (e.key === "Escape") {
                      setNameInput(currentUser.name);
                      setEditingName(false);
                    }
                  }}
                />
                <button
                  onClick={handleSaveDisplayName}
                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded-lg"
                >
                  {t("common:actions.save", { defaultValue: "Tallenna" })}
                </button>
                <button
                  onClick={() => {
                    setNameInput(currentUser.name);
                    setEditingName(false);
                  }}
                  className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  {t("common:actions.cancel", { defaultValue: "Peruuta" })}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {currentUser.name}
                </h1>
                <button
                  onClick={() => setEditingName(true)}
                  className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  {t("common:actions.edit", { defaultValue: "Muokkaa" })}
                </button>
              </div>
            )}
            {currentUser.verifiedName &&
              currentUser.verifiedName !== currentUser.name && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("profile:name.verifiedAs", {
                    defaultValue: "Virallinen nimi:",
                  })}{" "}
                  {currentUser.verifiedName}
                </p>
              )}
            <div className="flex items-center gap-2 mt-1">
              {currentUser.identityVerified && (
                <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full">
                  <Shield className="w-3 h-3" />
                  {currentUser.identityLevel === "high"
                    ? t("identity.highAssurance")
                    : currentUser.identityLevel === "substantial"
                      ? t("identity.substantial")
                      : t("identity.verified")}
                </span>
              )}
              {currentUser.municipality && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {currentUser.municipality.name}
                </span>
              )}
            </div>
            {avatarError && (
              <p className="text-xs text-red-600 mt-1">{avatarError}</p>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 py-6 space-y-6">
        {/* Identity section */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600" />
              {t("identity.title")}
            </h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {currentUser.identityLevel === "high"
                    ? t("identity.eudiConnected")
                    : t("identity.emailVerified")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {currentUser.identityLevel === "high"
                    ? t("identity.eudiDescription")
                    : t("identity.magicLink")}
                </p>
              </div>
              <span className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full">
                {t("identity.active")}
              </span>
            </div>
            <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {currentUser.identityLevel === "high"
                  ? t("identity.eudiInfo")
                  : t("identity.upgradeInfo")}
              </p>
            </div>
          </div>
        </div>

        {/* Institution Management - commented out temporarily
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-purple-600" />
              {t('institutions.title')}
            </h2>
          </div>
          <div className="p-4 space-y-4">
            {myInstitutions && myInstitutions.length > 0 ? (
              <div className="space-y-2">
                {myInstitutions.map(mgr => (
                  <div key={mgr.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-purple-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{mgr.institution.institutionName || mgr.institution.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t(`institutions.${mgr.institution.institutionType}`)} · {t(`institutions.role${mgr.role === 'owner' ? 'Owner' : 'Editor'}`)}
                        </p>
                      </div>
                    </div>
                    <div>
                      {mgr.status === 'approved' && (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full">
                          <CheckCircle className="w-3 h-3" />
                          {t('institutions.approved')}
                        </span>
                      )}
                      {mgr.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-full">
                          <Clock className="w-3 h-3" />
                          {t('institutions.pending')}
                        </span>
                      )}
                      {mgr.status === 'rejected' && (
                        <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-1 rounded-full">
                          <X className="w-3 h-3" />
                          {t('institutions.rejected')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('institutions.noInstitutions')}</p>
            )}

            <div className="pt-3 border-t border-gray-200 dark:border-gray-800">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('institutions.claimDesc')}</p>
              <button
                onClick={() => setShowAvailableInstitutions(!showAvailableInstitutions)}
                className="text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                {t('institutions.browse')}
              </button>
            </div>

            {showAvailableInstitutions && (
              <div className="space-y-2">
                {claimInstitutionMutation.isSuccess && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300">
                    {t('institutions.claimSent')}
                  </div>
                )}
                {claimInstitutionMutation.isError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                    {t('institutions.claimError')}
                  </div>
                )}
                {availableInstitutions && availableInstitutions.length > 0 ? (
                  availableInstitutions.map(inst => (
                    <div key={inst.id} className="flex items-center justify-between p-3 rounded-lg border border-purple-200 dark:border-gray-800 bg-purple-50 dark:bg-blue-900/30">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{inst.institutionName || inst.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t(`institutions.${inst.institutionType}`)}
                        </p>
                      </div>
                      <button
                        onClick={() => claimInstitutionMutation.mutate({ institutionId: inst.id })}
                        disabled={claimInstitutionMutation.isPending}
                        className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700 disabled:opacity-50"
                      >
                        {claimInstitutionMutation.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          t('institutions.claimButton')
                        )}
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('institutions.noAvailable')}</p>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-gray-200 dark:border-gray-800">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('institutions.createOrgDesc')}</p>
              <button
                onClick={() => setShowCreateOrg(!showCreateOrg)}
                className="text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                {t('institutions.createOrg')}
              </button>
            </div>

            {showCreateOrg && (
              <div className="space-y-3 p-4 bg-purple-50 dark:bg-blue-900/30 rounded-lg border border-purple-200 dark:border-gray-800">
                {createOrgMutation.isSuccess && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300">
                    {t('institutions.orgCreated')}
                  </div>
                )}
                {createOrgMutation.isError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                    {t('institutions.orgCreateError')}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('institutions.orgName')}</label>
                  <input
                    type="text"
                    value={orgForm.name}
                    onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder="Acme Oy"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('institutions.orgOfficialName')}</label>
                  <input
                    type="text"
                    value={orgForm.institutionName}
                    onChange={e => setOrgForm(f => ({ ...f, institutionName: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder="Acme Oyj"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('institutions.businessId')}</label>
                    <input
                      type="text"
                      value={orgForm.businessId}
                      onChange={e => setOrgForm(f => ({ ...f, businessId: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      placeholder={t('institutions.businessIdPlaceholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('institutions.businessIdCountry')}</label>
                    <select
                      value={orgForm.businessIdCountry}
                      onChange={e => setOrgForm(f => ({ ...f, businessIdCountry: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    >
                      <option value="FI">FI</option>
                      <option value="SE">SE</option>
                      <option value="EE">EE</option>
                      <option value="DE">DE</option>
                      <option value="FR">FR</option>
                      <option value="NL">NL</option>
                      <option value="IT">IT</option>
                      <option value="ES">ES</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('institutions.websiteUrl')}</label>
                  <input
                    type="url"
                    value={orgForm.websiteUrl}
                    onChange={e => setOrgForm(f => ({ ...f, websiteUrl: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder="https://example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('institutions.orgDescription')}</label>
                  <textarea
                    value={orgForm.description}
                    onChange={e => setOrgForm(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder={t('institutions.orgDescPlaceholder')}
                  />
                </div>
                <button
                  onClick={() => createOrgMutation.mutate({
                    name: orgForm.name,
                    institutionName: orgForm.institutionName || orgForm.name,
                    businessId: orgForm.businessId || undefined,
                    businessIdCountry: orgForm.businessId ? orgForm.businessIdCountry : undefined,
                    websiteUrl: orgForm.websiteUrl || undefined,
                    description: orgForm.description || undefined
                  })}
                  disabled={createOrgMutation.isPending || !orgForm.name.trim()}
                  className="w-full py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {createOrgMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('institutions.createOrgButton')}
                </button>
              </div>
            )}
          </div>
        </div>
        */}
        {/* Notification preferences */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-600" />
              {t("notifications.title")}
            </h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t("notifications.replies")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("notifications.repliesDesc")}
                </p>
              </div>
              <input
                type="checkbox"
                checked={notificationSettings.replies}
                onChange={() => handleNotificationChange("replies")}
                className="w-4 h-4 text-blue-600"
              />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t("notifications.mentions")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("notifications.mentionsDesc")}
                </p>
              </div>
              <input
                type="checkbox"
                checked={notificationSettings.mentions}
                onChange={() => handleNotificationChange("mentions")}
                className="w-4 h-4 text-blue-600"
              />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t("notifications.official")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("notifications.officialDesc")}
                </p>
              </div>
              <input
                type="checkbox"
                checked={notificationSettings.official}
                onChange={() => handleNotificationChange("official")}
                className="w-4 h-4 text-blue-600"
              />
            </div>
          </div>
          {pushSupported && (
            <div className="border-t border-gray-100 dark:border-gray-800">
              <div className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                    <BellRing className="w-3.5 h-3.5 text-blue-600" />
                    {t("notifications.push")}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t("notifications.pushDesc")}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={pushEnabled}
                  onChange={handlePushToggle}
                  disabled={pushLoading}
                  className="w-4 h-4 text-blue-600"
                />
              </div>
            </div>
          )}
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <Info className="w-3 h-3" />
              {t("notifications.noGrowthNudges")}
            </p>
          </div>
        </div>

        {/* Privacy & Data */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Eye className="w-4 h-4 text-blue-600" />
              {t("privacy.title")}
            </h2>
          </div>
          <div className="p-4 space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <p className="text-sm text-green-800 dark:text-green-300 font-medium">
                {t("privacy.notProduct")}
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                {t("privacy.notProductDesc")}
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t("privacy.dataStored")}
                  </span>
                </div>
                <Link
                  to="/profile/data"
                  className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                >
                  {t("common:actions.view")}
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <p>• {t("privacy.dataList.profile")}</p>
                <p>• {t("privacy.dataList.posts")}</p>
                <p>• {t("privacy.dataList.clubs")}</p>
                <p>• {t("privacy.dataList.notifications")}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <button
                onClick={handleExportData}
                disabled={exportDataMutation.isPending}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 flex items-center gap-2 disabled:opacity-50"
              >
                <ExternalLink className="w-4 h-4" />
                {exportDataMutation.isPending
                  ? t("privacy.exporting")
                  : t("privacy.exportData")}
              </button>

              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("privacy.deleteAccount")}
              </button>
            </div>

            {/* Delete account confirmation */}
            {showDeleteConfirm && (
              <div className="mt-3 pt-3 border-t border-red-200 bg-red-50 -mx-4 -mb-4 px-4 pb-4 rounded-b-xl">
                <p className="text-sm font-medium text-red-800 mb-1">
                  {t("privacy.deleteConfirmTitle")}
                </p>
                <p className="text-xs text-red-700 mb-3">
                  {t("privacy.deleteConfirmDesc")}
                </p>
                <div className="mb-3">
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={t("privacy.deleteConfirmPlaceholder")}
                    className="w-full px-3 py-2 text-sm border border-red-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await deleteAccountMutation.mutateAsync();
                      logout();
                      navigate("/");
                    }}
                    disabled={
                      deleteConfirmText !== "POISTA" ||
                      deleteAccountMutation.isPending
                    }
                    className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {deleteAccountMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    {t("privacy.deleteConfirmButton")}
                  </button>
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmText("");
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300"
                  >
                    {t("common:actions.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Security & Devices */}
        <DeviceManagementSection />

        {/* Language */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-600" />
              {t("language.title")}
            </h2>
          </div>
          <div className="p-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t("language.description")}
            </p>
            <LanguageSwitcher />
          </div>
        </div>

        {/* Theme */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Sun className="w-4 h-4 text-blue-600" />
              {t("theme.title")}
            </h2>
          </div>
          <div className="p-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t("theme.description")}
            </p>
            <div className="flex gap-2">
              {[
                { value: "light" as const, icon: Sun, label: t("theme.light") },
                { value: "dark" as const, icon: Moon, label: t("theme.dark") },
                {
                  value: "system" as const,
                  icon: Monitor,
                  label: t("theme.system"),
                },
              ].map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    theme === value
                      ? "bg-blue-800 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Guides */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-blue-600" />
              {t("guide:guidesSection")}
            </h2>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("guide:guidesDescription")}
            </p>
            <div className="space-y-2">
              {Object.values(guides).map((guide) => {
                const completed = hasCompletedGuide(guide.id);
                return (
                  <div
                    key={guide.id}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {t(guide.titleKey.replace("guide:", ""), { ns: "guide" })}
                    </span>
                    <div className="flex items-center gap-2">
                      {completed && (
                        <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                          {t("guide:completed")}
                        </span>
                      )}
                      <button
                        onClick={() => startGuide(guide.id)}
                        className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        {t("guide:viewGuide")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={resetAllGuides}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mt-2"
            >
              {t("guide:resetAll")}
            </button>
          </div>
        </div>

        {/* About Eulesia */}
        <Link
          to="/about"
          className="block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <span className="text-blue-800 font-bold">E</span>
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {t("aboutEulesia")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("aboutDesc")}
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500" />
          </div>
        </Link>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 text-red-600 hover:text-red-700 py-3"
        >
          <LogOut className="w-4 h-4" />
          <span>{t("signOut")}</span>
        </button>
      </div>
    </Layout>
  );
}

function DeviceManagementSection() {
  const { t } = useTranslation(["profile", "common"]);
  const queryClient = useQueryClient();
  const {
    deviceId,
    isInitialized,
    isInitializing,
    requiresTrust,
    requiresPairing,
    error,
    initializeCurrentDevice,
  } = useDevice();
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [isSubmittingPairingCode, setIsSubmittingPairingCode] = useState(false);
  const [isGeneratingPairingCode, setIsGeneratingPairingCode] = useState(false);
  const [generatedPairingCode, setGeneratedPairingCode] = useState<
    string | null
  >(null);
  const [generatedPairingExpiry, setGeneratedPairingExpiry] = useState<
    string | null
  >(null);

  const { data: devices, isLoading } = useQuery({
    queryKey: ["devices"],
    queryFn: () => api.listDevices(),
  });

  const deviceList = devices ?? [];
  const hasOtherDevices = deviceList.some((device) => device.id !== deviceId);
  const currentDevice = deviceList.find((device) => device.id === deviceId);
  const atDeviceLimit = !isInitialized && deviceList.length >= DEVICE_LIMIT;
  const isCurrentBrowserPaired = deviceId !== null;

  const handleTrustCurrentBrowser = async () => {
    try {
      await initializeCurrentDevice();
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      await queryClient.invalidateQueries({ queryKey: ["userDevices"] });
    } catch (err) {
      console.error("Device trust failed:", err);
    }
  };

  const handleRetrySetup = async () => {
    try {
      await initializeCurrentDevice();
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      await queryClient.invalidateQueries({ queryKey: ["userDevices"] });
    } catch (err) {
      console.error("Device retry failed:", err);
    }
  };

  const handlePairCurrentDevice = async () => {
    if (!pairingCode.trim()) {
      return;
    }

    setIsSubmittingPairingCode(true);
    try {
      await initializeCurrentDevice(pairingCode.trim());
      setPairingCode("");
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      await queryClient.invalidateQueries({ queryKey: ["userDevices"] });
    } catch (err) {
      console.error("Device pairing failed:", err);
    } finally {
      setIsSubmittingPairingCode(false);
    }
  };

  const handleGeneratePairingCode = async () => {
    setIsGeneratingPairingCode(true);
    try {
      const response = await api.createDevicePairingCode();
      setGeneratedPairingCode(response.code);
      setGeneratedPairingExpiry(response.expiresAt);
    } catch (err) {
      console.error("Failed to generate pairing code:", err);
    } finally {
      setIsGeneratingPairingCode(false);
    }
  };

  const handleRevokeDevice = async (targetDeviceId: string) => {
    const isLastPairedDevice =
      deviceList.filter((device) => device.id !== targetDeviceId).length === 0;
    const confirmed = window.confirm(
      isLastPairedDevice
        ? t("security.revokeLastDeviceWarning")
        : t("security.revokeDeviceConfirmation"),
    );
    if (!confirmed) {
      return;
    }

    setRevokingDeviceId(targetDeviceId);
    try {
      await api.revokeDevice(targetDeviceId);
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      await queryClient.invalidateQueries({ queryKey: ["userDevices"] });
    } catch (err) {
      console.error("Failed to revoke device:", err);
    } finally {
      setRevokingDeviceId(null);
    }
  };

  const statusTitle = isInitialized
    ? t("security.ready")
    : isInitializing
      ? t("security.settingUp")
      : requiresTrust
        ? t("security.trustRequired")
        : requiresPairing
          ? t("security.pairingRequired")
          : t("security.setupFailed");

  const statusDescription = isInitialized
    ? t("security.readyDescription")
    : isInitializing
      ? t("security.settingUpDescription")
      : requiresTrust
        ? t("security.trustRequiredDescription")
        : requiresPairing
          ? t("security.pairingRequiredDescription")
          : t("security.setupFailedDescription");

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Lock className="w-4 h-4 text-emerald-600" />
          {t("security.title")}
        </h2>
      </div>

      <div className="p-4 space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("security.description")}
        </p>

        <div
          className={`rounded-2xl border p-4 ${
            isInitialized
              ? "border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 dark:border-emerald-900 dark:from-emerald-950/30 dark:to-teal-950/20"
              : isInitializing
                ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20"
                : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {statusTitle}
                </p>
                {isInitializing && (
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                )}
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {statusDescription}
              </p>
              {requiresPairing && hasOtherDevices && (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  {t("security.newDeviceHint")}
                </p>
              )}
              {!isInitialized && atDeviceLimit && (
                <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                  {t("security.deviceLimitHint")}
                </p>
              )}
              {error && (
                <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                  {error}
                </p>
              )}
            </div>

            {requiresTrust && (
              <button
                type="button"
                onClick={handleTrustCurrentBrowser}
                disabled={isInitializing}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
              >
                {isInitializing && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("security.trustThisBrowser")}
              </button>
            )}

            {!isInitialized && !requiresPairing && !requiresTrust && (
              <button
                type="button"
                onClick={handleRetrySetup}
                disabled={isInitializing}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
              >
                {isInitializing && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("security.retrySetup")}
              </button>
            )}
          </div>

          {requiresPairing && hasOtherDevices && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-white/70 p-4 dark:border-amber-900 dark:bg-gray-950/20">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t("security.enterPairingCode")}
              </p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {t("security.enterPairingCodeDescription")}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={pairingCode}
                  onChange={(event) => setPairingCode(event.target.value)}
                  placeholder={t("security.pairingCodePlaceholder")}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-emerald-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
                <button
                  type="button"
                  onClick={handlePairCurrentDevice}
                  disabled={isSubmittingPairingCode || !pairingCode.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                >
                  {isSubmittingPairingCode && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {t("security.pairThisBrowser")}
                </button>
              </div>
            </div>
          )}

          {isInitialized && !atDeviceLimit && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-white/70 p-4 dark:border-emerald-900 dark:bg-gray-950/20">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t("security.generatePairingCode")}
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {t("security.generatePairingCodeDescription")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleGeneratePairingCode}
                  disabled={isGeneratingPairingCode}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/20"
                >
                  {isGeneratingPairingCode && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {t("security.newPairingCode")}
                </button>
              </div>

              {generatedPairingCode && (
                <div className="mt-4 rounded-lg bg-gray-950 px-4 py-3 text-white dark:bg-black">
                  <p className="text-xs uppercase tracking-[0.2em] text-gray-400">
                    {t("security.activePairingCode")}
                  </p>
                  <p className="mt-2 font-mono text-2xl tracking-[0.3em]">
                    {generatedPairingCode}
                  </p>
                  {generatedPairingExpiry && (
                    <p className="mt-2 text-xs text-gray-400">
                      {t("security.pairingCodeExpires", {
                        date: formatDeviceTimestamp(generatedPairingExpiry),
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("security.deviceList")}
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {deviceList.length}/{DEVICE_LIMIT}
            </span>
          </div>

          {!isCurrentBrowserPaired && deviceList.length > 0 && (
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
              {t("security.trustedDevicesHint")}
            </p>
          )}

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("common:actions.loading")}
            </div>
          ) : deviceList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-5 text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t("security.noDevices")}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("security.noDevicesDescription")}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {deviceList.map((device) => {
                const Icon = getDeviceIcon(device.platform);
                const isCurrentDevice = device.id === deviceId;
                const platformLabel =
                  device.platform === "android" || device.platform === "ios"
                    ? t("security.mobile")
                    : t("security.desktop");

                return (
                  <div
                    key={device.id}
                    className={`rounded-2xl border p-3 ${
                      isCurrentDevice
                        ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/20"
                        : "border-gray-200 dark:border-gray-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {device.displayName || t("security.thisBrowser")}
                            </p>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                isCurrentDevice
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                              }`}
                            >
                              {isCurrentDevice
                                ? t("security.currentDevice")
                                : isCurrentBrowserPaired
                                  ? t("security.otherDevice")
                                  : t("security.pairedDevice")}
                            </span>
                          </div>

                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {platformLabel} • ID {device.id.slice(-6)}
                          </p>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {t("security.registeredOn", {
                              date: formatDeviceTimestamp(device.createdAt),
                            })}
                          </p>
                          {isCurrentDevice && (
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                              {t("security.signOutToRemove")}
                            </p>
                          )}
                        </div>
                      </div>

                      {!isCurrentDevice && (
                        <button
                          type="button"
                          onClick={() => handleRevokeDevice(device.id)}
                          disabled={revokingDeviceId === device.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/20"
                        >
                          {revokingDeviceId === device.id ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              {t("security.revoking")}
                            </>
                          ) : (
                            t("security.revoke")
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {currentDevice && (
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {t("security.registeredOn", {
                date: formatDeviceTimestamp(currentDevice.createdAt),
              })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
