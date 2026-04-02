import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Shield,
  ShieldCheck,
  ShieldX,
  Calendar,
  MessageSquare,
  FileText,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { AdminLayout } from "../../components/admin";
import {
  useAdminUser,
  useChangeUserRole,
  useToggleVerification,
  useIssueSanction,
  useRevokeSanction,
} from "../../hooks/useAdminApi";
import { formatRelativeTime, formatDateLong } from "../../lib/formatTime";

export function AdminUserDetailPage() {
  const { t } = useTranslation("admin");
  const { id } = useParams<{ id: string }>();
  const { data: user, isLoading } = useAdminUser(id || "");
  const changeRoleMutation = useChangeUserRole();
  const toggleVerificationMutation = useToggleVerification();
  const issueSanctionMutation = useIssueSanction();
  const revokeSanctionMutation = useRevokeSanction();

  const [showSanctionForm, setShowSanctionForm] = useState(false);
  const [sanctionType, setSanctionType] = useState<
    "warning" | "suspension" | "ban"
  >("warning");
  const [sanctionReason, setSanctionReason] = useState("");
  const [sanctionExpiry, setSanctionExpiry] = useState("");
  const [pendingRole, setPendingRole] = useState<
    "citizen" | "institution" | null
  >(null);

  if (isLoading || !user) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  const isSopsManagedAdmin = false; // Admin accounts are now separate entities

  const handleRoleChange = (newRole: "citizen" | "institution") => {
    if (!id || newRole === user?.role) return;
    setPendingRole(newRole);
  };

  const confirmRoleChange = () => {
    if (!id || !pendingRole) return;
    changeRoleMutation.mutate(
      { id, role: pendingRole },
      {
        onSuccess: () => {
          setPendingRole(null);
        },
      },
    );
  };

  const handleIssueSanction = async () => {
    if (!id || !sanctionReason.trim()) return;
    await issueSanctionMutation.mutateAsync({
      userId: id,
      data: {
        sanctionType,
        reason: sanctionReason,
        expiresAt: sanctionExpiry || undefined,
      },
    });
    setShowSanctionForm(false);
    setSanctionReason("");
    setSanctionExpiry("");
  };

  const activeSanctions = user.sanctions?.filter((s) => !s.revokedAt) || [];

  return (
    <AdminLayout>
      {/* Back */}
      <Link
        to="/admin/users"
        className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("users.backToUsers")}
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* User info */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <span className="text-blue-600 text-xl font-bold">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {user.name}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                @{user.username}
              </p>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <Calendar className="w-4 h-4" />
              {t("userDetail.joined", { date: formatDateLong(user.createdAt) })}
            </div>
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <MessageSquare className="w-4 h-4" />
              {t("userDetail.threads", { count: user.threadCount })}
            </div>
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <FileText className="w-4 h-4" />
              {t("userDetail.comments", { count: user.commentCount })}
            </div>
            {user.identityVerified ? (
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <Shield className="w-4 h-4" />
                {t("userDetail.verified")}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                <Shield className="w-4 h-4" />
                {t("userDetail.notVerified")}
              </div>
            )}
          </div>

          {/* Verify / Unverify */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              {t("userDetail.verification")}
            </label>
            {user.identityVerified ? (
              <button
                onClick={() =>
                  id &&
                  toggleVerificationMutation.mutate({ id, verified: false })
                }
                disabled={
                  toggleVerificationMutation.isPending || isSopsManagedAdmin
                }
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                {toggleVerificationMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <ShieldX className="w-4 h-4" />
                    {t("userDetail.removeVerification")}
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() =>
                  id &&
                  toggleVerificationMutation.mutate({ id, verified: true })
                }
                disabled={
                  toggleVerificationMutation.isPending || isSopsManagedAdmin
                }
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
              >
                {toggleVerificationMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    {t("userDetail.grantVerification")}
                  </>
                )}
              </button>
            )}
            {isSopsManagedAdmin && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t("userDetail.verificationManagedBySops")}
              </p>
            )}
          </div>

          {/* Role change */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              {t("userDetail.role")}
            </label>
            <select
              value={user.role}
              onChange={(e) => handleRoleChange(e.target.value as any)}
              disabled={changeRoleMutation.isPending || isSopsManagedAdmin}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="citizen">{t("users.citizen")}</option>
              <option value="institution">{t("users.institution")}</option>
              <option value="admin" disabled>
                {t("users.admin")}
              </option>
            </select>
            {isSopsManagedAdmin && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t("userDetail.roleManagedBySops")}
              </p>
            )}
          </div>
        </div>

        {/* Sanctions */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active sanctions warning */}
          {activeSanctions.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-2 text-red-800 font-medium mb-2">
                <AlertTriangle className="w-4 h-4" />
                {t("userDetail.activeSanctions", {
                  count: activeSanctions.length,
                })}
              </div>
              {activeSanctions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between py-2 border-t border-red-100 first:border-0"
                >
                  <div>
                    <span className="text-sm font-medium text-red-800 capitalize">
                      {s.sanctionType}
                    </span>
                    <span className="text-xs text-red-600 ml-2">
                      {s.reason}
                    </span>
                    {s.expiresAt && (
                      <span className="text-xs text-red-500 ml-2">
                        {t("userDetail.expiresAt", {
                          date: formatDateLong(s.expiresAt),
                        })}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => revokeSanctionMutation.mutate(s.id)}
                    disabled={revokeSanctionMutation.isPending}
                    className="text-xs px-3 py-1 bg-white dark:bg-gray-900 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    {t("userDetail.revoke")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Sanction form */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("userDetail.sanctions")}
              </h2>
              {!showSanctionForm && (
                <button
                  onClick={() => setShowSanctionForm(true)}
                  className="text-sm px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  {t("userDetail.issueSanction")}
                </button>
              )}
            </div>

            {showSanctionForm && (
              <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 mb-4 space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                    {t("userDetail.sanctionType")}
                  </label>
                  <select
                    value={sanctionType}
                    onChange={(e) => setSanctionType(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 dark:text-gray-100"
                  >
                    <option value="warning">{t("userDetail.warning")}</option>
                    <option value="suspension">
                      {t("userDetail.suspension")}
                    </option>
                    <option value="ban">{t("userDetail.ban")}</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                    {t("userDetail.reason")}
                  </label>
                  <textarea
                    value={sanctionReason}
                    onChange={(e) => setSanctionReason(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm resize-none dark:bg-gray-900 dark:text-gray-100"
                    rows={3}
                  />
                </div>
                {sanctionType !== "ban" && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                      {t("userDetail.expiryDate")}
                    </label>
                    <input
                      type="datetime-local"
                      value={sanctionExpiry}
                      onChange={(e) => setSanctionExpiry(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-900 dark:text-gray-100"
                    />
                  </div>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowSanctionForm(false)}
                    className="text-sm px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={handleIssueSanction}
                    disabled={
                      !sanctionReason.trim() || issueSanctionMutation.isPending
                    }
                    className="text-sm px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    {t("userDetail.confirm")}
                  </button>
                </div>
              </div>
            )}

            {/* Sanction history */}
            <div className="space-y-2">
              {user.sanctions?.map((s) => (
                <div
                  key={s.id}
                  className={`p-3 rounded-lg ${s.revokedAt ? "bg-gray-50 dark:bg-gray-800/50" : "bg-red-50 dark:bg-red-900/20"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium capitalize">
                      {s.sanctionType}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {formatRelativeTime(s.issuedAt)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {s.reason}
                  </p>
                  {s.revokedAt && (
                    <span className="text-xs text-green-600 mt-1 inline-block">
                      {t("userDetail.revokedAt", {
                        date: formatRelativeTime(s.revokedAt),
                      })}
                    </span>
                  )}
                </div>
              ))}
              {!user.sanctions?.length && (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
                  {t("userDetail.noSanctions")}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Role change confirmation modal */}
      {pendingRole && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setPendingRole(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <Shield className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {t("userDetail.confirmRoleTitle")}
                </h3>
              </div>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {t("userDetail.confirmRoleDesc", {
                name: user.name,
                role: t(`users.${pendingRole}`),
              })}
            </p>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingRole(null)}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={confirmRoleChange}
                disabled={changeRoleMutation.isPending}
                className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 bg-blue-600 hover:bg-blue-700"
              >
                {changeRoleMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  t("userDetail.confirm")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
