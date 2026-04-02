import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type {
  IssueSanctionData,
  SubmitReportData,
  SubmitAppealData,
} from "../lib/api";

// Query keys
export const adminKeys = {
  dashboard: ["admin", "dashboard"] as const,
  users: (params?: unknown) => ["admin", "users", params] as const,
  user: (id: string) => ["admin", "user", id] as const,
  userSanctions: (id: string) => ["admin", "userSanctions", id] as const,
  reports: (params?: unknown) => ["admin", "reports", params] as const,
  report: (id: string) => ["admin", "report", id] as const,
  modlog: (params?: unknown) => ["admin", "modlog", params] as const,
  transparency: (from?: string, to?: string) =>
    ["admin", "transparency", from, to] as const,
  appeals: (params?: unknown) => ["admin", "appeals", params] as const,
  settings: ["admin", "settings"] as const,
  invites: (status?: string) => ["admin", "invites", status] as const,
  mySanctions: ["mySanctions"] as const,
  announcements: ["admin", "announcements"] as const,
  institutionClaims: ["admin", "institutionClaims"] as const,
  waitlist: (params?: unknown) => ["admin", "waitlist", params] as const,
  waitlistStats: ["admin", "waitlistStats"] as const,
};

// Dashboard
export function useAdminDashboard() {
  return useQuery({
    queryKey: adminKeys.dashboard,
    queryFn: () => api.getAdminDashboard(),
    refetchInterval: 60_000,
  });
}

// Users
export function useAdminUsers(params?: {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
}) {
  return useQuery({
    queryKey: adminKeys.users(params),
    queryFn: () => api.getAdminUsers(params),
  });
}

export function useAdminUser(id: string) {
  return useQuery({
    queryKey: adminKeys.user(id),
    queryFn: () => api.getAdminUser(id),
    enabled: !!id,
  });
}

export function useChangeUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      role,
    }: {
      id: string;
      role: "citizen" | "institution";
    }) => api.changeUserRole(id, role),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.user(id) });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}

// Verification
export function useToggleVerification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, verified }: { id: string; verified: boolean }) =>
      api.toggleVerification(id, verified),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.user(id) });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}

// Sanctions
export function useIssueSanction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      data,
    }: {
      userId: string;
      data: IssueSanctionData;
    }) => api.issueSanction(userId, data),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) });
      queryClient.invalidateQueries({
        queryKey: adminKeys.userSanctions(userId),
      });
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}

export function useUserSanctions(userId: string) {
  return useQuery({
    queryKey: adminKeys.userSanctions(userId),
    queryFn: () => api.getUserSanctions(userId),
    enabled: !!userId,
  });
}

export function useRevokeSanction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sanctionId: string) => api.revokeSanction(sanctionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}

// Reports
export function useAdminReports(params?: {
  page?: number;
  limit?: number;
  status?: string;
  reason?: string;
  contentType?: string;
}) {
  return useQuery({
    queryKey: adminKeys.reports(params),
    queryFn: () => api.getAdminReports(params),
  });
}

export function useAdminReport(id: string) {
  return useQuery({
    queryKey: adminKeys.report(id),
    queryFn: () => api.getAdminReport(id),
    enabled: !!id,
  });
}

export function useUpdateReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { status: string; reason?: string };
    }) => api.updateReport(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}

// Content moderation
export function useRemoveContent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      type,
      id,
      reason,
    }: {
      type: string;
      id: string;
      reason?: string;
    }) => api.removeContent(type, id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}

export function useRestoreContent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, id }: { type: string; id: string }) =>
      api.restoreContent(type, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}

// Mod log
export function useModLog(params?: {
  page?: number;
  limit?: number;
  actionType?: string;
  adminId?: string;
}) {
  return useQuery({
    queryKey: adminKeys.modlog(params),
    queryFn: () => api.getModLog(params),
  });
}

// Transparency
export function useTransparencyStats(from?: string, to?: string) {
  return useQuery({
    queryKey: adminKeys.transparency(from, to),
    queryFn: () => api.getTransparencyStats(from, to),
  });
}

// Appeals
export function useAdminAppeals(params?: {
  page?: number;
  limit?: number;
  status?: string;
}) {
  return useQuery({
    queryKey: adminKeys.appeals(params),
    queryFn: () => api.getAdminAppeals(params),
  });
}

export function useResolveAppeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { status: "accepted" | "rejected"; adminResponse: string };
    }) => api.resolveAppeal(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "appeals"] });
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}

// Settings
export function useAdminSettings() {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: () => api.getAdminSettings(),
  });
}

export function useUpdateAdminSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { registrationOpen?: boolean }) =>
      api.updateAdminSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.settings });
      queryClient.invalidateQueries({ queryKey: adminKeys.modlog() });
    },
  });
}

export function useAdminInvites(status?: "available" | "used" | "revoked") {
  return useQuery({
    queryKey: adminKeys.invites(status),
    queryFn: () => api.getAdminInvites(status),
  });
}

export function useGenerateAdminInvites() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (count: number) => api.generateAdminInvites(count),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "invites"] });
      queryClient.invalidateQueries({ queryKey: adminKeys.modlog() });
    },
  });
}

// User-facing hooks
export function useSubmitReport() {
  return useMutation({
    mutationFn: (data: SubmitReportData) => api.submitReport(data),
  });
}

export function useSubmitAppeal() {
  return useMutation({
    mutationFn: (data: SubmitAppealData) => api.submitAppeal(data),
  });
}

export function useMySanctions() {
  return useQuery({
    queryKey: adminKeys.mySanctions,
    queryFn: () => api.getMySanctions(),
  });
}

// System announcements (admin)
export function useAdminAnnouncements() {
  return useQuery({
    queryKey: adminKeys.announcements,
    queryFn: () => api.getAdminAnnouncements(),
  });
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title: string;
      message: string;
      type: "info" | "warning" | "critical";
      expiresAt?: string;
    }) => api.createAnnouncement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.announcements });
    },
  });
}

export function useToggleAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.toggleAnnouncement(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.announcements });
    },
  });
}

export function useDeleteAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAnnouncement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.announcements });
    },
  });
}

// Institution claims (admin)
export function useAdminInstitutionClaims() {
  return useQuery({
    queryKey: adminKeys.institutionClaims,
    queryFn: () => api.getInstitutionClaims(),
  });
}

export function useAdminUpdateClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      claimId,
      status,
    }: {
      claimId: string;
      status: "approved" | "rejected";
    }) => api.updateInstitutionClaim(claimId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.institutionClaims });
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}

// Waitlist (admin)
export function useAdminWaitlist(params?: {
  page?: number;
  limit?: number;
  status?: string;
}) {
  return useQuery({
    queryKey: adminKeys.waitlist(params),
    queryFn: () => api.getWaitlist(params),
  });
}

export function useWaitlistStats() {
  return useQuery({
    queryKey: adminKeys.waitlistStats,
    queryFn: () => api.getWaitlistStats(),
    refetchInterval: 60_000,
  });
}

export function useApproveWaitlistEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.approveWaitlistEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "waitlist"] });
      queryClient.invalidateQueries({ queryKey: adminKeys.waitlistStats });
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}

export function useRejectWaitlistEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api.rejectWaitlistEntry(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "waitlist"] });
      queryClient.invalidateQueries({ queryKey: adminKeys.waitlistStats });
    },
  });
}

export function useBulkApproveWaitlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.bulkApproveWaitlist(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "waitlist"] });
      queryClient.invalidateQueries({ queryKey: adminKeys.waitlistStats });
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}
