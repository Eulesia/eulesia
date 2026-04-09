import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AdminLayout } from "../../components/admin";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import {
  useAdminSettings,
  useUpdateAdminSettings,
  useAdminInvites,
  useGenerateAdminInvites,
  useAdminAnnouncements,
  useCreateAnnouncement,
  useToggleAnnouncement,
  useDeleteAnnouncement,
} from "../../hooks/useAdminApi";
import {
  Users,
  ShieldCheck,
  KeyRound,
  Loader2,
  Save,
  Info,
  Megaphone,
  Trash2,
  Eye,
  EyeOff,
  Gift,
  Plus,
  Check,
  Copy,
  Fingerprint,
} from "lucide-react";
import { api } from "../../lib/api";

function ToggleSwitch({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
        enabled ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function AdminPasswordChangeCard() {
  const { admin } = useAdminAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await api.adminChangePassword({ currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err?.message || "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
          <KeyRound className="w-4 h-4 text-blue-600" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">
            Change password
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {admin?.username}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-3">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded-lg">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm rounded-lg">
            Password changed successfully
          </div>
        )}

        <div>
          <label
            htmlFor="admin-current-pw"
            className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Current password
          </label>
          <input
            id="admin-current-pw"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setError(null);
              setSuccess(false);
            }}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label
            htmlFor="admin-new-pw"
            className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            New password
          </label>
          <input
            id="admin-new-pw"
            type="password"
            autoComplete="new-password"
            minLength={6}
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setError(null);
              setSuccess(false);
            }}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label
            htmlFor="admin-confirm-pw"
            className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Confirm new password
          </label>
          <input
            id="admin-confirm-pw"
            type="password"
            autoComplete="new-password"
            minLength={6}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setError(null);
              setSuccess(false);
            }}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Changing..." : "Change password"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Admin2faCard() {
  const { beginPasskeyRegistration, beginTotpSetup, confirmTotpSetup } =
    useAdminAuth();
  const [status, setStatus] = useState<{
    totpEnabled: boolean;
    passkeys: {
      id: string;
      name: string;
      createdAt: string;
      lastUsedAt: string | null;
    }[];
    unusedRecoveryCodes: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Passkey add
  const [showAddPasskey, setShowAddPasskey] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [addingPasskey, setAddingPasskey] = useState(false);

  // TOTP setup
  const [showTotpSetup, setShowTotpSetup] = useState(false);
  const [totpQrUri, setTotpQrUri] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [confirmingTotp, setConfirmingTotp] = useState(false);

  // Recovery codes display
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // Reset 2FA
  const [showReset, setShowReset] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.admin2faStatus();
      setStatus(data);
    } catch {
      // Not set up yet or error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleAddPasskey = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingPasskey(true);
    setError(null);
    try {
      const result = await beginPasskeyRegistration(
        passkeyName || "Admin passkey",
      );
      if (result.recoveryCodes && result.recoveryCodes.length > 0) {
        setRecoveryCodes(result.recoveryCodes);
      }
      setShowAddPasskey(false);
      setPasskeyName("");
      setSuccess("Passkey registered successfully");
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || "Failed to register passkey");
    } finally {
      setAddingPasskey(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    setError(null);
    try {
      await api.adminPasskeyDelete(id);
      setSuccess("Passkey deleted");
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || "Failed to delete passkey");
    }
  };

  const handleStartTotp = async () => {
    setError(null);
    try {
      const result = await beginTotpSetup();
      setTotpQrUri(result.qrUri);
      setTotpSecret(result.secret);
      setShowTotpSetup(true);
    } catch (err: any) {
      setError(err?.message || "Failed to start TOTP setup");
    }
  };

  const handleConfirmTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfirmingTotp(true);
    setError(null);
    try {
      const result = await confirmTotpSetup(totpCode);
      setRecoveryCodes(result.recoveryCodes);
      setShowTotpSetup(false);
      setTotpCode("");
      setSuccess("TOTP enabled successfully");
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || "Failed to confirm TOTP");
    } finally {
      setConfirmingTotp(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetting(true);
    setError(null);
    try {
      await api.admin2faReset(resetPassword);
      setShowReset(false);
      setResetPassword("");
      setSuccess("All 2FA methods have been reset");
      setRecoveryCodes(null);
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || "Failed to reset 2FA");
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
          <Fingerprint className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">
            Two-factor authentication
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Manage passkeys, TOTP, and recovery codes
          </p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded-lg">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm rounded-lg">
            {success}
          </div>
        )}

        {/* Recovery codes display */}
        {recoveryCodes && recoveryCodes.length > 0 && (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg space-y-3">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Save your recovery codes
            </p>
            <div className="grid grid-cols-2 gap-1">
              {recoveryCodes.map((code, i) => (
                <code
                  key={i}
                  className="text-xs font-mono text-amber-700 dark:text-amber-300"
                >
                  {code}
                </code>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(recoveryCodes.join("\n"));
                setCopiedCodes(true);
                setTimeout(() => setCopiedCodes(false), 2000);
              }}
              className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100"
            >
              {copiedCodes ? (
                <Check className="w-3 h-3" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              {copiedCodes ? "Copied" : "Copy codes"}
            </button>
          </div>
        )}

        {/* Passkeys section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Passkeys
            </p>
            <button
              type="button"
              onClick={() => setShowAddPasskey(!showAddPasskey)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              {showAddPasskey ? "Cancel" : "Add passkey"}
            </button>
          </div>

          {showAddPasskey && (
            <form
              onSubmit={handleAddPasskey}
              className="mb-3 flex items-center gap-2"
            >
              <input
                type="text"
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
                placeholder="Passkey name (optional)"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={addingPasskey}
                className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
              >
                {addingPasskey ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Fingerprint className="w-4 h-4" />
                )}
                Register
              </button>
            </form>
          )}

          {status && status.passkeys.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
              {status.passkeys.map((pk) => (
                <div
                  key={pk.id}
                  className="flex items-center justify-between px-4 py-2.5 bg-gray-50/50 dark:bg-gray-800/30"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {pk.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Added {new Date(pk.createdAt).toLocaleDateString("fi")}
                      {pk.lastUsedAt &&
                        ` — last used ${new Date(pk.lastUsedAt).toLocaleDateString("fi")}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeletePasskey(pk.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              No passkeys registered
            </p>
          )}
        </div>

        {/* TOTP section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Authenticator app (TOTP)
            </p>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                status?.totpEnabled
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              }`}
            >
              {status?.totpEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>

          {!status?.totpEnabled && !showTotpSetup && (
            <button
              type="button"
              onClick={handleStartTotp}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Set up TOTP
            </button>
          )}

          {showTotpSetup && (
            <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <div className="flex justify-center">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(totpQrUri)}`}
                  alt="TOTP QR Code"
                  className="w-40 h-40 rounded-lg border border-gray-200 dark:border-gray-700"
                />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Secret:
                </p>
                <code className="block w-full p-2 bg-white dark:bg-gray-900 rounded text-xs text-gray-700 dark:text-gray-300 font-mono text-center break-all select-all">
                  {totpSecret}
                </code>
              </div>
              <form onSubmit={handleConfirmTotp} className="flex gap-2">
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="000000"
                  className="flex-1 px-3 py-2 text-sm text-center font-mono tracking-widest border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
                <button
                  type="submit"
                  disabled={confirmingTotp || !totpCode}
                  className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {confirmingTotp ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Verify"
                  )}
                </button>
              </form>
              <button
                type="button"
                onClick={() => setShowTotpSetup(false)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Recovery codes count */}
        {status && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Unused recovery codes
            </p>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {status.unusedRecoveryCodes}
            </span>
          </div>
        )}

        {/* Reset 2FA */}
        {status && (status.totpEnabled || status.passkeys.length > 0) && (
          <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
            {!showReset ? (
              <button
                type="button"
                onClick={() => setShowReset(true)}
                className="text-sm text-red-600 hover:text-red-700 font-medium"
              >
                Reset all 2FA methods
              </button>
            ) : (
              <form onSubmit={handleReset} className="space-y-3">
                <p className="text-sm text-red-600 dark:text-red-400">
                  This will remove all passkeys, disable TOTP, and invalidate
                  recovery codes. Enter your password to confirm.
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="Your password"
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    required
                  />
                  <button
                    type="submit"
                    disabled={resetting || !resetPassword}
                    className="px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    {resetting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Reset"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReset(false);
                      setResetPassword("");
                    }}
                    className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AdminSettingsPage() {
  const { t } = useTranslation("admin");
  const { data: settings, isLoading } = useAdminSettings();
  const updateSettings = useUpdateAdminSettings();
  const { data: adminInvites, isLoading: invitesLoading } = useAdminInvites();
  const generateInvites = useGenerateAdminInvites();
  const [registrationOpenDraft, setRegistrationOpenDraft] = useState<
    boolean | null
  >(null);
  const [generateCount, setGenerateCount] = useState(5);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // Announcement state
  const { data: adminAnnouncements } = useAdminAnnouncements();
  const createAnnouncement = useCreateAnnouncement();
  const toggleAnnouncement = useToggleAnnouncement();
  const deleteAnnouncement = useDeleteAnnouncement();
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [announcementType, setAnnouncementType] = useState<
    "info" | "warning" | "critical"
  >("info");

  const registrationOpen =
    registrationOpenDraft ?? settings?.registrationOpen ?? true;
  const hasChanges =
    registrationOpenDraft !== null &&
    registrationOpenDraft !== (settings?.registrationOpen ?? true);

  const handleSave = () => {
    updateSettings.mutate(
      {
        registrationOpen,
      },
      {
        onSuccess: () => setRegistrationOpenDraft(null),
      },
    );
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("settings.title")}
        </h1>
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={updateSettings.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {updateSettings.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {t("settings.save")}
          </button>
        )}
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* Password change */}
        <AdminPasswordChangeCard />

        {/* Two-factor authentication */}
        <Admin2faCard />

        {/* Admin invite generation */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
              <Gift className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("settings.generateInvites")}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("settings.generateInvitesDesc")}
              </p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Generate controls */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setGenerateCount(Math.max(1, generateCount - 1))
                  }
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  −
                </button>
                <span className="w-10 text-center font-semibold text-gray-900 dark:text-gray-100 dark:text-gray-100">
                  {generateCount}
                </span>
                <button
                  onClick={() =>
                    setGenerateCount(Math.min(50, generateCount + 1))
                  }
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  +
                </button>
              </div>
              <button
                onClick={() => generateInvites.mutate(generateCount)}
                disabled={generateInvites.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {generateInvites.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {t("settings.generate")}
              </button>
            </div>

            {/* Invite code list */}
            {invitesLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : adminInvites && adminInvites.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {t("settings.generatedCodes")}
                  </p>
                  {adminInvites.filter((c) => c.status === "available").length >
                    0 && (
                    <button
                      onClick={() => {
                        const available = adminInvites
                          .filter((c) => c.status === "available")
                          .map((c) => c.code);
                        navigator.clipboard.writeText(available.join("\n"));
                        setCopiedAll(true);
                        setTimeout(() => setCopiedAll(false), 2000);
                      }}
                      className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 transition-colors"
                    >
                      {copiedAll ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      {copiedAll ? t("settings.copied") : t("settings.copyAll")}
                    </button>
                  )}
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
                  {adminInvites.map((code) => (
                    <div
                      key={code.id}
                      className="flex items-center justify-between px-4 py-2.5 bg-gray-50/50 dark:bg-gray-800/30"
                    >
                      <div className="flex items-center gap-3">
                        <code
                          className={`text-sm font-mono ${code.status === "available" ? "text-gray-900 dark:text-gray-100" : "text-gray-400 dark:text-gray-500 line-through"}`}
                        >
                          {code.code}
                        </code>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            code.status === "available"
                              ? "bg-green-100 text-green-700"
                              : code.status === "used"
                                ? "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                                : "bg-red-100 text-red-600"
                          }`}
                        >
                          {code.status === "available"
                            ? t("settings.inviteAvailable")
                            : code.status === "used"
                              ? code.usedBy
                                ? code.usedBy.name
                                : t("settings.inviteUsed")
                              : t("settings.inviteRevoked")}
                        </span>
                      </div>
                      {code.status === "available" && (
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(code.code);
                            setCopiedCode(code.id);
                            setTimeout(() => setCopiedCode(null), 2000);
                          }}
                          className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {copiedCode === code.id ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                {t("settings.noInviteCodes")}
              </p>
            )}
          </div>
        </div>

        {/* Registration */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
              <Users className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("settings.registration")}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("settings.registrationDesc")}
              </p>
            </div>
          </div>

          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t("settings.registrationOpen")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("settings.registrationOpenDesc")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {t("settings.registrationModeInfo")}
                </p>
              </div>
              <ToggleSwitch
                enabled={registrationOpen}
                onChange={(val) => {
                  setRegistrationOpenDraft(val);
                }}
              />
            </div>
          </div>
        </div>

        {/* System announcements */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
              <Megaphone className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("settings.announcements")}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("settings.announcementsDesc")}
              </p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Create new */}
            <div className="space-y-3">
              <input
                type="text"
                value={announcementTitle}
                onChange={(e) => setAnnouncementTitle(e.target.value)}
                placeholder={t("settings.announcementTitle")}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-gray-100"
                maxLength={200}
              />
              <textarea
                value={announcementMessage}
                onChange={(e) => setAnnouncementMessage(e.target.value)}
                placeholder={t("settings.announcementMessage")}
                rows={2}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-gray-100 resize-none"
                maxLength={2000}
              />
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  {(["info", "warning", "critical"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setAnnouncementType(type)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        announcementType === type
                          ? type === "info"
                            ? "bg-blue-600 text-white"
                            : type === "warning"
                              ? "bg-amber-500 text-white"
                              : "bg-red-600 text-white"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                      }`}
                    >
                      {t(`settings.announcementType.${type}`)}
                    </button>
                  ))}
                </div>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    if (!announcementTitle.trim()) return;
                    createAnnouncement.mutate(
                      {
                        title: announcementTitle.trim(),
                        message:
                          announcementMessage.trim() ||
                          announcementTitle.trim(),
                        type: announcementType,
                      },
                      {
                        onSuccess: () => {
                          setAnnouncementTitle("");
                          setAnnouncementMessage("");
                          setAnnouncementType("info");
                        },
                      },
                    );
                  }}
                  disabled={
                    !announcementTitle.trim() || createAnnouncement.isPending
                  }
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {createAnnouncement.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Megaphone className="w-4 h-4" />
                  )}
                  {t("settings.publishAnnouncement")}
                </button>
              </div>
            </div>

            {/* Existing announcements */}
            {adminAnnouncements && adminAnnouncements.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {t("settings.existingAnnouncements")}
                </p>
                <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
                  {adminAnnouncements.map((a) => (
                    <div
                      key={a.id}
                      className={`flex items-center justify-between px-4 py-3 ${a.active ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800/50"}`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            a.type === "info"
                              ? "bg-blue-500"
                              : a.type === "warning"
                                ? "bg-amber-500"
                                : "bg-red-500"
                          }`}
                        />
                        <div className="min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${a.active ? "text-gray-900 dark:text-gray-100" : "text-gray-400 dark:text-gray-500"}`}
                          >
                            {a.title}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            {a.createdByName} —{" "}
                            {new Date(a.createdAt).toLocaleDateString("fi")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() =>
                            toggleAnnouncement.mutate({
                              id: a.id,
                              active: !a.active,
                            })
                          }
                          className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                          title={
                            a.active
                              ? t("settings.hideAnnouncement")
                              : t("settings.showAnnouncement")
                          }
                        >
                          {a.active ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => deleteAnnouncement.mutate(a.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                          title={t("settings.deleteAnnouncement")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* DSA compliance info */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
            <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("settings.platformSettings")}
              </h2>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg flex items-start gap-3">
              <Info className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("settings.dsaCompliance")}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("settings.dsaDescription")}
                </p>
              </div>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg flex items-start gap-3">
              <Info className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("settings.moderationPolicy")}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("settings.moderationDescription")}
                </p>
              </div>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg flex items-start gap-3">
              <Info className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("settings.autoModeration")}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("settings.autoModerationDescription")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
