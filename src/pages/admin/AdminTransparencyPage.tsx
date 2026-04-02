import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, BarChart3 } from "lucide-react";
import { AdminLayout } from "../../components/admin";
import { useTransparencyStats } from "../../hooks/useAdminApi";

export function AdminTransparencyPage() {
  const { t } = useTranslation("admin");
  const [period, setPeriod] = useState("30");

  const { from, to } = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return {
      from: new Date(
        now - parseInt(period) * 24 * 60 * 60 * 1000,
      ).toISOString(),
      to: new Date(now).toISOString(),
    };
  }, [period]);

  const { data, isLoading } = useTransparencyStats(from, to);

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("transparency.title")}
        </h1>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="7">{t("transparency.last7days")}</option>
          <option value="30">{t("transparency.last30days")}</option>
          <option value="90">{t("transparency.last90days")}</option>
          <option value="365">{t("transparency.lastYear")}</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Response time */}
          {data.reports.avgResponseTimeHours !== null && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {t("transparency.avgResponseTime")}
              </h2>
              <p className="text-3xl font-bold text-blue-600">
                {data.reports.avgResponseTimeHours}h
              </p>
            </div>
          )}

          {/* Reports */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <StatsCard
              title={t("transparency.reportsByStatus")}
              items={data.reports.byStatus}
              labelKey="status"
            />
            <StatsCard
              title={t("transparency.reportsByReason")}
              items={data.reports.byReason}
              labelKey="reason"
            />
            <StatsCard
              title={t("transparency.reportsByType")}
              items={data.reports.byContentType}
              labelKey="contentType"
            />
          </div>

          {/* Actions & Sanctions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <StatsCard
              title={t("transparency.actionsByType")}
              items={data.actions.byType}
              labelKey="actionType"
            />
            <StatsCard
              title={t("transparency.sanctionsByType")}
              items={data.sanctions.byType}
              labelKey="sanctionType"
            />
            <StatsCard
              title={t("transparency.appealsByStatus")}
              items={data.appeals.byStatus}
              labelKey="status"
            />
          </div>
        </div>
      ) : (
        <div className="text-center py-12">
          <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">
            {t("transparency.noData")}
          </p>
        </div>
      )}
    </AdminLayout>
  );
}

function StatsCard({
  title,
  items,
  labelKey,
}: {
  title: string;
  items: { count: number; [key: string]: any }[];
  labelKey: string;
}) {
  const total = items.reduce((sum, i) => sum + i.count, 0);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
        {title}
      </h3>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">
                {String(item[labelKey]).replace(/_/g, " ")}
              </span>
              <div className="flex items-center gap-2">
                <div className="w-24 bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{
                      width: `${total > 0 ? (item.count / total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 w-8 text-right">
                  {item.count}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">-</p>
      )}
    </div>
  );
}
