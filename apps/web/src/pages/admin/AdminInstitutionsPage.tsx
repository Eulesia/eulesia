import { useTranslation } from "react-i18next";
import { Building2, CheckCircle, XCircle, Loader2, Clock } from "lucide-react";
import { AdminLayout } from "../../components/admin";
import {
  useAdminInstitutionClaims,
  useAdminUpdateClaim,
} from "../../hooks/useAdminApi";
import { formatDateLong } from "../../lib/formatTime";

export function AdminInstitutionsPage() {
  const { t } = useTranslation("admin");
  const { data: claims, isLoading } = useAdminInstitutionClaims();
  const updateClaimMutation = useAdminUpdateClaim();

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        {t("institutions.title")}
      </h1>

      {!claims || claims.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">
            {t("institutions.noPending")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {claims.map((claim) => (
            <div
              key={claim.id}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Building2 className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {claim.institution.institutionName ||
                        claim.institution.name}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {claim.institution.institutionType}
                    </p>
                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="font-medium">
                        {t("institutions.requestedBy")}:
                      </span>{" "}
                      {claim.user.name} ({claim.user.email})
                    </div>
                    <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDateLong(claim.createdAt)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() =>
                      updateClaimMutation.mutate({
                        claimId: claim.id,
                        status: "approved",
                      })
                    }
                    disabled={updateClaimMutation.isPending}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {t("institutions.approve")}
                  </button>
                  <button
                    onClick={() =>
                      updateClaimMutation.mutate({
                        claimId: claim.id,
                        status: "rejected",
                      })
                    }
                    disabled={updateClaimMutation.isPending}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    {t("institutions.reject")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
