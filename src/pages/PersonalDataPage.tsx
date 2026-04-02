import {
  ArrowLeft,
  Download,
  Loader2,
  Database,
  MessageSquare,
  Users,
  Bell,
  FileText,
  Home,
  ThumbsUp,
  Shield,
  Key,
  Mail,
  History,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { api } from "../lib/api";

interface DataExport {
  exportedAt: string;
  user: { name: string; email: string; createdAt: string };
  threads: unknown[];
  comments: unknown[];
  threadVotes: unknown[];
  commentVotes: unknown[];
  directMessages: unknown[];
  conversations: unknown[];
  clubMemberships: unknown[];
  rooms: unknown[];
  roomMemberships: unknown[];
  roomThreads: unknown[];
  roomComments: unknown[];
  roomInvitations: { sent: unknown[]; received: unknown[] };
  notifications: unknown[];
  subscriptions: unknown[];
  sessions: unknown[];
  sanctions: unknown[];
  appeals: unknown[];
  reports: unknown[];
  editHistory: unknown[];
  inviteCodes: unknown[];
}

export function PersonalDataPage() {
  const { t } = useTranslation("profile");

  const { data, isLoading } = useQuery({
    queryKey: ["personal-data"],
    queryFn: () => api.exportData() as Promise<DataExport>,
  });

  const exportMutation = useMutation({
    mutationFn: () => api.exportData(),
    onSuccess: (result) => {
      const blob = new Blob([JSON.stringify(result, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "eulesia-my-data.json";
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const categories = data
    ? [
        {
          icon: <FileText className="w-4 h-4" />,
          label: t("personalData.threads"),
          count: data.threads?.length ?? 0,
        },
        {
          icon: <MessageSquare className="w-4 h-4" />,
          label: t("personalData.comments"),
          count: data.comments?.length ?? 0,
        },
        {
          icon: <ThumbsUp className="w-4 h-4" />,
          label: t("personalData.votes"),
          count:
            (data.threadVotes?.length ?? 0) + (data.commentVotes?.length ?? 0),
        },
        {
          icon: <Mail className="w-4 h-4" />,
          label: t("personalData.directMessages"),
          count: data.directMessages?.length ?? 0,
        },
        {
          icon: <Users className="w-4 h-4" />,
          label: t("personalData.clubMemberships"),
          count: data.clubMemberships?.length ?? 0,
        },
        {
          icon: <Home className="w-4 h-4" />,
          label: t("personalData.rooms"),
          count:
            (data.rooms?.length ?? 0) + (data.roomMemberships?.length ?? 0),
        },
        {
          icon: <MessageSquare className="w-4 h-4" />,
          label: t("personalData.roomThreads"),
          count:
            (data.roomThreads?.length ?? 0) + (data.roomComments?.length ?? 0),
        },
        {
          icon: <Bell className="w-4 h-4" />,
          label: t("personalData.notifications"),
          count: data.notifications?.length ?? 0,
        },
        {
          icon: <Database className="w-4 h-4" />,
          label: t("personalData.subscriptions"),
          count: data.subscriptions?.length ?? 0,
        },
        {
          icon: <Key className="w-4 h-4" />,
          label: t("personalData.sessions"),
          count: data.sessions?.length ?? 0,
        },
        {
          icon: <Shield className="w-4 h-4" />,
          label: t("personalData.moderation"),
          count:
            (data.sanctions?.length ?? 0) +
            (data.appeals?.length ?? 0) +
            (data.reports?.length ?? 0),
        },
        {
          icon: <History className="w-4 h-4" />,
          label: t("personalData.editHistory"),
          count: data.editHistory?.length ?? 0,
        },
      ]
    : [];

  return (
    <Layout>
      <SEOHead title={t("personalData.title")} path="/profile/data" noIndex />
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <Link
          to="/profile"
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("personalData.back")}
        </Link>
      </div>

      <div className="px-4 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {t("personalData.title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("personalData.description")}
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-600" />
                  {t("personalData.storedData")}
                </h2>
              </div>
              <div className="divide-y divide-gray-100 dark:border-gray-800">
                {categories.map((cat, i) => (
                  <div
                    key={i}
                    className="px-4 py-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 dark:text-gray-500">
                        {cat.icon}
                      </span>
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {cat.label}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {cat.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl p-4">
              <p className="text-sm text-blue-800 mb-3">
                {t("personalData.exportInfo")}
              </p>
              <button
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {exportMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {t("privacy.exportData")}
              </button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
