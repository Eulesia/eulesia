import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminLayout } from "../../components/admin";
import {
  useAdminWaitlist,
  useWaitlistStats,
  useApproveWaitlistEntry,
  useRejectWaitlistEntry,
  useBulkApproveWaitlist,
} from "../../hooks/useAdminApi";
import {
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { formatDateLong } from "../../lib/formatTime";

type StatusFilter = "pending" | "approved" | "rejected";

export function AdminWaitlistPage() {
  const { t } = useTranslation("admin");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [approvedCodes, setApprovedCodes] = useState<Record<string, string>>(
    {},
  );

  const { data: stats } = useWaitlistStats();
  const { data, isLoading } = useAdminWaitlist({
    page,
    limit: 20,
    status: statusFilter,
  });
  const approveMutation = useApproveWaitlistEntry();
  const rejectMutation = useRejectWaitlistEntry();
  const bulkApproveMutation = useBulkApproveWaitlist();

  const handleApprove = async (id: string) => {
    const result = await approveMutation.mutateAsync(id);
    setApprovedCodes((prev) => ({ ...prev, [id]: result.code }));
  };

  const handleReject = (id: string) => {
    if (confirm(t("waitlist.confirmReject"))) {
      rejectMutation.mutate({ id });
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(t("waitlist.confirmApprove"))) return;
    const result = await bulkApproveMutation.mutateAsync(
      Array.from(selectedIds),
    );
    const codes: Record<string, string> = {};
    result.results?.forEach((r: { id: string; code: string }) => {
      codes[r.id] = r.code;
    });
    setApprovedCodes((prev) => ({ ...prev, ...codes }));
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data?.items) return;
    const pendingIds = data.items
      .filter((e) => e.status === "pending")
      .map((e) => e.id);
    if (selectedIds.size === pendingIds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingIds));
    }
  };

  const items = data?.items || [];
  const total = data?.total || 0;
  const limit = data?.limit || 20;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const totalPages = Math.ceil(total / limit);

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          {t("waitlist.title")}
        </h1>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            {(["pending", "approved", "rejected", "total"] as const).map(
              (key) => (
                <div
                  key={key}
                  className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
                >
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {t(`waitlist.stats.${key}`)}
                  </div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                    {stats[key]}
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {/* Status filter tabs */}
        <div className="flex gap-2 mb-4">
          {(["pending", "approved", "rejected"] as const).map((status) => (
            <button
              key={status}
              onClick={() => {
                setStatusFilter(status);
                setPage(1);
                setSelectedIds(new Set());
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === status
                  ? "bg-blue-800 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {t(`waitlist.${status}`)}
              {stats && (
                <span className="ml-1.5 text-xs opacity-75">
                  ({stats[status]})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Bulk actions */}
        {statusFilter === "pending" && selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
              {t("waitlist.selected", { count: selectedIds.size })}
            </span>
            <button
              onClick={handleBulkApprove}
              disabled={bulkApproveMutation.isPending}
              className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
            >
              {bulkApproveMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              {t("waitlist.bulkApprove")}
            </button>
          </div>
        )}

        {/* Table */}
        {items.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <Clock className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
            <p>{t("waitlist.noEntries")}</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  {statusFilter === "pending" && (
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={
                          items.filter((e) => e.status === "pending").length >
                            0 &&
                          selectedIds.size ===
                            items.filter((e) => e.status === "pending").length
                        }
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 dark:border-gray-600"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                    {t("waitlist.columns.email")}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                    {t("waitlist.columns.name")}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                    {t("waitlist.columns.submitted")}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                    {t("waitlist.columns.status")}
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">
                    {t("waitlist.columns.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((entry) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-900/50"
                  >
                    {statusFilter === "pending" && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(entry.id)}
                          onChange={() => toggleSelect(entry.id)}
                          className="rounded border-gray-300 dark:border-gray-600"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-mono text-xs">
                      {entry.email}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {entry.name || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                      {formatDateLong(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {entry.status === "pending" && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                          <Clock className="w-3 h-3" />
                          {t("waitlist.pending")}
                        </span>
                      )}
                      {entry.status === "approved" && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                          <CheckCircle className="w-3 h-3" />
                          {t("waitlist.approved")}
                        </span>
                      )}
                      {entry.status === "rejected" && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                          <XCircle className="w-3 h-3" />
                          {t("waitlist.rejected")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {entry.status === "pending" && (
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => handleApprove(entry.id)}
                            disabled={approveMutation.isPending}
                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors disabled:opacity-50"
                            title={t("waitlist.approve")}
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleReject(entry.id)}
                            disabled={rejectMutation.isPending}
                            className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                            title={t("waitlist.reject")}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                      {approvedCodes[entry.id] && (
                        <span className="text-xs text-green-600 dark:text-green-400 font-mono">
                          {t("waitlist.codeSent", {
                            code: approvedCodes[entry.id],
                          })}
                        </span>
                      )}
                      {entry.status === "approved" &&
                        entry.emailSentAt &&
                        !approvedCodes[entry.id] && (
                          <span className="text-xs text-gray-400">
                            {t("waitlist.emailSent")}
                          </span>
                        )}
                      {entry.status === "rejected" && entry.note && (
                        <span className="text-xs text-gray-400 italic">
                          {entry.note}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {t("waitlist.showing", { from, to, total })}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 text-gray-600 dark:text-gray-400"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400 px-2">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 text-gray-600 dark:text-gray-400"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
