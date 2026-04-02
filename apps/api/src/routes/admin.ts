import { Router, type Response } from "express";
import { z } from "zod";
import { eq, desc, and, sql, count, or, gt, ilike } from "drizzle-orm";
import {
  db,
  users,
  threads,
  comments,
  clubs,
  clubThreads,
  clubComments,
  contentReports,
  moderationActions,
  userSanctions,
  moderationAppeals,
  siteSettings,
  inviteCodes,
  systemAnnouncements,
  adminAccounts,
} from "../db/index.js";
import { randomBytes } from "crypto";
import { adminAuthMiddleware } from "../middleware/adminAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { notify } from "../services/notify.js";
import type { AdminAuthenticatedRequest } from "../types/index.js";

const router = Router();

// All admin routes require admin auth
router.use(adminAuthMiddleware);

// ─── Dashboard ──────────────────────────────────────────────

router.get(
  "/dashboard",
  asyncHandler(async (_req: AdminAuthenticatedRequest, res: Response) => {
    const [userCount] = await db.select({ count: count() }).from(users);
    const [threadCount] = await db.select({ count: count() }).from(threads);
    const [clubCount] = await db.select({ count: count() }).from(clubs);
    const [pendingReports] = await db
      .select({ count: count() })
      .from(contentReports)
      .where(eq(contentReports.status, "pending"));
    const [pendingAppeals] = await db
      .select({ count: count() })
      .from(moderationAppeals)
      .where(eq(moderationAppeals.status, "pending"));

    // Recent reports
    const recentReports = await db
      .select({
        id: contentReports.id,
        contentType: contentReports.contentType,
        reason: contentReports.reason,
        status: contentReports.status,
        createdAt: contentReports.createdAt,
        reporterName: users.name,
      })
      .from(contentReports)
      .leftJoin(users, eq(contentReports.reporterUserId, users.id))
      .orderBy(desc(contentReports.createdAt))
      .limit(10);

    // Recent moderation actions
    const recentActions = await db
      .select({
        id: moderationActions.id,
        actionType: moderationActions.actionType,
        targetType: moderationActions.targetType,
        reason: moderationActions.reason,
        createdAt: moderationActions.createdAt,
        adminName: adminAccounts.name,
      })
      .from(moderationActions)
      .leftJoin(
        adminAccounts,
        eq(moderationActions.adminUserId, adminAccounts.id),
      )
      .orderBy(desc(moderationActions.createdAt))
      .limit(10);

    res.json({
      success: true,
      data: {
        stats: {
          totalUsers: userCount.count,
          totalThreads: threadCount.count,
          totalClubs: clubCount.count,
          pendingReports: pendingReports.count,
          pendingAppeals: pendingAppeals.count,
        },
        recentReports,
        recentActions,
      },
    });
  }),
);

// ─── Users ──────────────────────────────────────────────────

router.get(
  "/users",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { page = "1", limit = "20", search, role } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (search) {
      const searchTerm = `%${search}%`;
      conditions.push(
        or(
          ilike(users.name, searchTerm),
          ilike(users.email, searchTerm),
          ilike(users.username, searchTerm),
        ),
      );
    }
    if (role && ["citizen", "institution", "admin"].includes(role as string)) {
      conditions.push(
        eq(users.role, role as "citizen" | "institution" | "admin"),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(users)
      .where(whereClause);
    const userList = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: users.role,
        institutionType: users.institutionType,
        institutionName: users.institutionName,
        identityVerified: users.identityVerified,
        createdAt: users.createdAt,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(limitNum)
      .offset(offset);

    res.json({
      success: true,
      data: {
        items: userList,
        total: totalResult.count,
        page: pageNum,
        limit: limitNum,
        hasMore: offset + limitNum < totalResult.count,
      },
    });
  }),
);

router.get(
  "/users/:id",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw new AppError(404, "User not found");

    // Get active sanctions
    const sanctions = await db
      .select()
      .from(userSanctions)
      .where(eq(userSanctions.userId, id))
      .orderBy(desc(userSanctions.issuedAt));

    // Get user's thread count
    const [threadCount] = await db
      .select({ count: count() })
      .from(threads)
      .where(eq(threads.authorId, id));
    const [commentCount] = await db
      .select({ count: count() })
      .from(comments)
      .where(eq(comments.authorId, id));

    const { passwordHash: _, ...safeUser } = user;

    res.json({
      success: true,
      data: {
        ...safeUser,
        sanctions,
        threadCount: threadCount.count,
        commentCount: commentCount.count,
      },
    });
  }),
);

// PATCH /admin/users/:id/role
const changeRoleSchema = z.object({
  role: z.enum(["citizen", "institution"]),
});

router.patch(
  "/users/:id/role",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { role } = changeRoleSchema.parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw new AppError(404, "User not found");

    const oldRole = user.role;
    await db.update(users).set({ role }).where(eq(users.id, id));

    // Log action
    await db.insert(moderationActions).values({
      adminUserId: req.admin!.id,
      actionType: "role_changed",
      targetType: "user",
      targetId: id,
      reason: `Role changed from ${oldRole} to ${role}`,
      metadata: { oldRole, newRole: role },
    });

    res.json({ success: true, data: { id, role } });
  }),
);

// PATCH /admin/users/:id/verify
router.patch(
  "/users/:id/verify",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { verified } = z.object({ verified: z.boolean() }).parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw new AppError(404, "User not found");

    await db
      .update(users)
      .set({ identityVerified: verified })
      .where(eq(users.id, id));

    // Log action
    await db.insert(moderationActions).values({
      adminUserId: req.admin!.id,
      actionType: verified ? "user_verified" : "user_unverified",
      targetType: "user",
      targetId: id,
      reason: verified
        ? "Identity verified by admin"
        : "Identity verification removed by admin",
      metadata: { identityVerified: verified },
    });

    res.json({ success: true, data: { id, identityVerified: verified } });
  }),
);

// ─── Sanctions ──────────────────────────────────────────────

const issueSanctionSchema = z.object({
  sanctionType: z.enum(["warning", "suspension", "ban"]),
  reason: z.string().min(1).max(5000),
  expiresAt: z.string().datetime().optional(),
});

router.post(
  "/users/:id/sanction",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { sanctionType, reason, expiresAt } = issueSanctionSchema.parse(
      req.body,
    );

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw new AppError(404, "User not found");

    if (user.role === "admin")
      throw new AppError(400, "Cannot sanction an admin");

    const [sanction] = await db
      .insert(userSanctions)
      .values({
        userId: id,
        sanctionType,
        reason,
        issuedBy: req.admin!.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .returning();

    // Log action
    const actionType =
      sanctionType === "warning"
        ? "user_warned"
        : sanctionType === "suspension"
          ? "user_suspended"
          : "user_banned";

    await db.insert(moderationActions).values({
      adminUserId: req.admin!.id,
      actionType,
      targetType: "user",
      targetId: id,
      reason,
      metadata: { sanctionId: sanction.id, sanctionType, expiresAt },
    });

    // Notify user
    await notify({
      userId: id,
      type: "sanction",
      title:
        sanctionType === "warning"
          ? "You have received a warning"
          : sanctionType === "suspension"
            ? "Your account has been suspended"
            : "Your account has been banned",
      body: reason,
      link: "/profile",
    });

    res.json({ success: true, data: sanction });
  }),
);

router.get(
  "/users/:id/sanctions",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const sanctions = await db
      .select({
        id: userSanctions.id,
        sanctionType: userSanctions.sanctionType,
        reason: userSanctions.reason,
        issuedAt: userSanctions.issuedAt,
        expiresAt: userSanctions.expiresAt,
        revokedAt: userSanctions.revokedAt,
        issuerName: adminAccounts.name,
      })
      .from(userSanctions)
      .leftJoin(adminAccounts, eq(userSanctions.issuedBy, adminAccounts.id))
      .where(eq(userSanctions.userId, id))
      .orderBy(desc(userSanctions.issuedAt));

    res.json({ success: true, data: sanctions });
  }),
);

router.delete(
  "/sanctions/:id",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const [sanction] = await db
      .select()
      .from(userSanctions)
      .where(eq(userSanctions.id, id))
      .limit(1);
    if (!sanction) throw new AppError(404, "Sanction not found");

    await db
      .update(userSanctions)
      .set({
        revokedAt: new Date(),
        revokedBy: req.admin!.id,
      })
      .where(eq(userSanctions.id, id));

    // Log action
    await db.insert(moderationActions).values({
      adminUserId: req.admin!.id,
      actionType: "user_unbanned",
      targetType: "user",
      targetId: sanction.userId,
      reason: `Sanction ${sanction.sanctionType} revoked`,
      metadata: { sanctionId: id, sanctionType: sanction.sanctionType },
    });

    // Notify user
    await notify({
      userId: sanction.userId,
      type: "sanction_revoked",
      title: "Your sanction has been revoked",
      body: `Your ${sanction.sanctionType} has been lifted.`,
      link: "/profile",
    });

    res.json({ success: true, data: { revoked: true } });
  }),
);

// ─── Reports ────────────────────────────────────────────────

router.get(
  "/reports",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { page = "1", limit = "20", status, reason, contentType } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (
      status &&
      ["pending", "reviewing", "resolved", "dismissed"].includes(
        status as string,
      )
    ) {
      conditions.push(eq(contentReports.status, status as any));
    }
    if (
      reason &&
      ["illegal", "harassment", "spam", "misinformation", "other"].includes(
        reason as string,
      )
    ) {
      conditions.push(eq(contentReports.reason, reason as any));
    }
    if (contentType) {
      conditions.push(eq(contentReports.contentType, contentType as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(contentReports)
      .where(whereClause);

    const reports = await db
      .select({
        id: contentReports.id,
        contentType: contentReports.contentType,
        contentId: contentReports.contentId,
        reason: contentReports.reason,
        description: contentReports.description,
        status: contentReports.status,
        createdAt: contentReports.createdAt,
        resolvedAt: contentReports.resolvedAt,
        reporterName: users.name,
        reporterUserId: contentReports.reporterUserId,
      })
      .from(contentReports)
      .leftJoin(users, eq(contentReports.reporterUserId, users.id))
      .where(whereClause)
      .orderBy(desc(contentReports.createdAt))
      .limit(limitNum)
      .offset(offset);

    res.json({
      success: true,
      data: {
        items: reports,
        total: totalResult.count,
        page: pageNum,
        limit: limitNum,
        hasMore: offset + limitNum < totalResult.count,
      },
    });
  }),
);

router.get(
  "/reports/:id",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const [report] = await db
      .select({
        id: contentReports.id,
        contentType: contentReports.contentType,
        contentId: contentReports.contentId,
        reason: contentReports.reason,
        description: contentReports.description,
        status: contentReports.status,
        assignedTo: contentReports.assignedTo,
        createdAt: contentReports.createdAt,
        resolvedAt: contentReports.resolvedAt,
        reporterUserId: contentReports.reporterUserId,
        reporterName: users.name,
      })
      .from(contentReports)
      .leftJoin(users, eq(contentReports.reporterUserId, users.id))
      .where(eq(contentReports.id, id))
      .limit(1);

    if (!report) throw new AppError(404, "Report not found");

    // Fetch the reported content
    let content: any = null;
    switch (report.contentType) {
      case "thread": {
        const [t] = await db
          .select()
          .from(threads)
          .where(eq(threads.id, report.contentId))
          .limit(1);
        content = t;
        break;
      }
      case "comment": {
        const [c] = await db
          .select()
          .from(comments)
          .where(eq(comments.id, report.contentId))
          .limit(1);
        content = c;
        break;
      }
      case "club_thread": {
        const [ct] = await db
          .select()
          .from(clubThreads)
          .where(eq(clubThreads.id, report.contentId))
          .limit(1);
        content = ct;
        break;
      }
      case "club_comment": {
        const [cc] = await db
          .select()
          .from(clubComments)
          .where(eq(clubComments.id, report.contentId))
          .limit(1);
        content = cc;
        break;
      }
      case "club": {
        const [cl] = await db
          .select()
          .from(clubs)
          .where(eq(clubs.id, report.contentId))
          .limit(1);
        content = cl;
        break;
      }
      case "user": {
        const [u] = await db
          .select({
            id: users.id,
            name: users.name,
            username: users.username,
            role: users.role,
          })
          .from(users)
          .where(eq(users.id, report.contentId))
          .limit(1);
        content = u;
        break;
      }
    }

    res.json({ success: true, data: { ...report, content } });
  }),
);

const updateReportSchema = z.object({
  status: z.enum(["reviewing", "resolved", "dismissed"]),
  reason: z.string().optional(),
});

router.patch(
  "/reports/:id",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { status, reason } = updateReportSchema.parse(req.body);

    const [report] = await db
      .select()
      .from(contentReports)
      .where(eq(contentReports.id, id))
      .limit(1);
    if (!report) throw new AppError(404, "Report not found");

    const updates: any = { status };
    if (status === "resolved" || status === "dismissed") {
      updates.resolvedAt = new Date();
    }
    if (status === "reviewing") {
      updates.assignedTo = req.admin!.id;
    }

    await db
      .update(contentReports)
      .set(updates)
      .where(eq(contentReports.id, id));

    // Log action
    const actionType =
      status === "dismissed" ? "report_dismissed" : "report_resolved";
    if (status === "resolved" || status === "dismissed") {
      await db.insert(moderationActions).values({
        adminUserId: req.admin!.id,
        actionType,
        targetType: report.contentType,
        targetId: report.contentId,
        reportId: id,
        reason: reason || `Report ${status}`,
      });
    }

    res.json({ success: true, data: { id, status } });
  }),
);

// ─── Content moderation ─────────────────────────────────────

router.delete(
  "/content/:type/:id",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { type, id } = req.params;
    const { reason } = req.body || {};

    switch (type) {
      case "thread":
        await db
          .update(threads)
          .set({ isHidden: true } as any)
          .where(eq(threads.id, id));
        break;
      case "comment":
        await db
          .update(comments)
          .set({ isHidden: true } as any)
          .where(eq(comments.id, id));
        break;
      case "club_thread":
        await db
          .update(clubThreads)
          .set({ isHidden: true } as any)
          .where(eq(clubThreads.id, id));
        break;
      case "club_comment":
        await db
          .update(clubComments)
          .set({ isHidden: true } as any)
          .where(eq(clubComments.id, id));
        break;
      default:
        throw new AppError(400, "Invalid content type");
    }

    await db.insert(moderationActions).values({
      adminUserId: req.admin!.id,
      actionType: "content_removed",
      targetType: type as any,
      targetId: id,
      reason: reason || "Content removed by admin",
    });

    res.json({ success: true, data: { hidden: true } });
  }),
);

router.post(
  "/content/:type/:id/restore",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { type, id } = req.params;

    switch (type) {
      case "thread":
        await db
          .update(threads)
          .set({ isHidden: false } as any)
          .where(eq(threads.id, id));
        break;
      case "comment":
        await db
          .update(comments)
          .set({ isHidden: false } as any)
          .where(eq(comments.id, id));
        break;
      case "club_thread":
        await db
          .update(clubThreads)
          .set({ isHidden: false } as any)
          .where(eq(clubThreads.id, id));
        break;
      case "club_comment":
        await db
          .update(clubComments)
          .set({ isHidden: false } as any)
          .where(eq(clubComments.id, id));
        break;
      default:
        throw new AppError(400, "Invalid content type");
    }

    await db.insert(moderationActions).values({
      adminUserId: req.admin!.id,
      actionType: "content_restored",
      targetType: type as any,
      targetId: id,
      reason: "Content restored by admin",
    });

    res.json({ success: true, data: { restored: true } });
  }),
);

// ─── Moderation Log ─────────────────────────────────────────

router.get(
  "/modlog",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { page = "1", limit = "30", actionType, adminId } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (actionType) {
      conditions.push(eq(moderationActions.actionType, actionType as any));
    }
    if (adminId) {
      conditions.push(eq(moderationActions.adminUserId, adminId as string));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(moderationActions)
      .where(whereClause);

    const actions = await db
      .select({
        id: moderationActions.id,
        actionType: moderationActions.actionType,
        targetType: moderationActions.targetType,
        targetId: moderationActions.targetId,
        reason: moderationActions.reason,
        metadata: moderationActions.metadata,
        createdAt: moderationActions.createdAt,
        adminName: adminAccounts.name,
        adminUserId: moderationActions.adminUserId,
      })
      .from(moderationActions)
      .leftJoin(
        adminAccounts,
        eq(moderationActions.adminUserId, adminAccounts.id),
      )
      .where(whereClause)
      .orderBy(desc(moderationActions.createdAt))
      .limit(limitNum)
      .offset(offset);

    res.json({
      success: true,
      data: {
        items: actions,
        total: totalResult.count,
        page: pageNum,
        limit: limitNum,
        hasMore: offset + limitNum < totalResult.count,
      },
    });
  }),
);

// ─── Transparency (DSA) ─────────────────────────────────────

router.get(
  "/transparency",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { from, to } = req.query;
    const fromDate = from
      ? new Date(from as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to as string) : new Date();

    const dateCondition = and(
      gt(contentReports.createdAt, fromDate),
      sql`${contentReports.createdAt} <= ${toDate}`,
    );

    // Reports by status
    const reportsByStatus = await db
      .select({
        status: contentReports.status,
        count: count(),
      })
      .from(contentReports)
      .where(dateCondition)
      .groupBy(contentReports.status);

    // Reports by reason
    const reportsByReason = await db
      .select({
        reason: contentReports.reason,
        count: count(),
      })
      .from(contentReports)
      .where(dateCondition)
      .groupBy(contentReports.reason);

    // Reports by content type
    const reportsByContentType = await db
      .select({
        contentType: contentReports.contentType,
        count: count(),
      })
      .from(contentReports)
      .where(dateCondition)
      .groupBy(contentReports.contentType);

    // Moderation actions in period
    const actionDateCondition = and(
      gt(moderationActions.createdAt, fromDate),
      sql`${moderationActions.createdAt} <= ${toDate}`,
    );

    const actionsByType = await db
      .select({
        actionType: moderationActions.actionType,
        count: count(),
      })
      .from(moderationActions)
      .where(actionDateCondition)
      .groupBy(moderationActions.actionType);

    // Sanctions in period
    const sanctionDateCondition = and(
      gt(userSanctions.issuedAt, fromDate),
      sql`${userSanctions.issuedAt} <= ${toDate}`,
    );

    const sanctionsByType = await db
      .select({
        sanctionType: userSanctions.sanctionType,
        count: count(),
      })
      .from(userSanctions)
      .where(sanctionDateCondition)
      .groupBy(userSanctions.sanctionType);

    // Appeals in period
    const appealDateCondition = and(
      gt(moderationAppeals.createdAt, fromDate),
      sql`${moderationAppeals.createdAt} <= ${toDate}`,
    );

    const appealsByStatus = await db
      .select({
        status: moderationAppeals.status,
        count: count(),
      })
      .from(moderationAppeals)
      .where(appealDateCondition)
      .groupBy(moderationAppeals.status);

    // Median response time for reports
    const [avgResponseTime] = await db
      .select({
        avg: sql<number>`AVG(EXTRACT(EPOCH FROM (${contentReports.resolvedAt} - ${contentReports.createdAt})) / 3600)`,
      })
      .from(contentReports)
      .where(and(dateCondition, sql`${contentReports.resolvedAt} IS NOT NULL`));

    res.json({
      success: true,
      data: {
        period: { from: fromDate, to: toDate },
        reports: {
          byStatus: reportsByStatus,
          byReason: reportsByReason,
          byContentType: reportsByContentType,
          avgResponseTimeHours: avgResponseTime?.avg
            ? Math.round(avgResponseTime.avg * 10) / 10
            : null,
        },
        actions: { byType: actionsByType },
        sanctions: { byType: sanctionsByType },
        appeals: { byStatus: appealsByStatus },
      },
    });
  }),
);

// ─── Appeals ────────────────────────────────────────────────

router.get(
  "/appeals",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { page = "1", limit = "20", status } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (
      status &&
      ["pending", "accepted", "rejected"].includes(status as string)
    ) {
      conditions.push(eq(moderationAppeals.status, status as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const [totalResult] = await db
      .select({ count: count() })
      .from(moderationAppeals)
      .where(whereClause);

    const appeals = await db
      .select({
        id: moderationAppeals.id,
        reason: moderationAppeals.reason,
        status: moderationAppeals.status,
        adminResponse: moderationAppeals.adminResponse,
        createdAt: moderationAppeals.createdAt,
        respondedAt: moderationAppeals.respondedAt,
        sanctionId: moderationAppeals.sanctionId,
        reportId: moderationAppeals.reportId,
        actionId: moderationAppeals.actionId,
        userId: moderationAppeals.userId,
        userName: users.name,
      })
      .from(moderationAppeals)
      .leftJoin(users, eq(moderationAppeals.userId, users.id))
      .where(whereClause)
      .orderBy(desc(moderationAppeals.createdAt))
      .limit(limitNum)
      .offset(offset);

    res.json({
      success: true,
      data: {
        items: appeals,
        total: totalResult.count,
        page: pageNum,
        limit: limitNum,
        hasMore: offset + limitNum < totalResult.count,
      },
    });
  }),
);

const resolveAppealSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  adminResponse: z.string().min(1).max(5000),
});

router.patch(
  "/appeals/:id",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { status, adminResponse } = resolveAppealSchema.parse(req.body);

    const [appeal] = await db
      .select()
      .from(moderationAppeals)
      .where(eq(moderationAppeals.id, id))
      .limit(1);
    if (!appeal) throw new AppError(404, "Appeal not found");

    await db
      .update(moderationAppeals)
      .set({
        status,
        adminResponse,
        respondedBy: req.admin!.id,
        respondedAt: new Date(),
      })
      .where(eq(moderationAppeals.id, id));

    // If accepted and there's a sanction, revoke it
    if (status === "accepted" && appeal.sanctionId) {
      await db
        .update(userSanctions)
        .set({
          revokedAt: new Date(),
          revokedBy: req.admin!.id,
        })
        .where(eq(userSanctions.id, appeal.sanctionId));
    }

    // Notify user
    await notify({
      userId: appeal.userId,
      type: "appeal_response",
      title:
        status === "accepted"
          ? "Your appeal has been accepted"
          : "Your appeal has been rejected",
      body: adminResponse,
      link: "/profile",
    });

    res.json({ success: true, data: { id, status } });
  }),
);

// ============================================================
// SITE SETTINGS
// ============================================================

// GET /admin/settings - Get all site settings
router.get(
  "/settings",
  asyncHandler(async (_req, res: Response) => {
    const settings = await db.select().from(siteSettings);
    const settingsMap: Record<string, string> = {};
    for (const s of settings) {
      settingsMap[s.key] = s.value;
    }

    // Return with defaults
    res.json({
      success: true,
      data: {
        registrationOpen: settingsMap["registration_open"] !== "false", // default: true
      },
    });
  }),
);

// PATCH /admin/settings - Update site settings
router.patch(
  "/settings",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const schema = z.object({
      registrationOpen: z.boolean().optional(),
    });
    const data = schema.parse(req.body);

    const updates: { key: string; value: string }[] = [];
    if (data.registrationOpen !== undefined) {
      updates.push({
        key: "registration_open",
        value: String(data.registrationOpen),
      });
    }

    for (const { key, value } of updates) {
      await db
        .insert(siteSettings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: { value, updatedAt: new Date() },
        });
    }

    await db.insert(moderationActions).values({
      adminUserId: req.admin!.id,
      actionType: "settings_changed",
      targetType: "system",
      targetId: "site_settings",
      reason: "Site settings updated",
      metadata: data,
    });

    res.json({ success: true });
  }),
);

// PATCH /admin/users/:id/invites - Set invite count for a user
router.patch(
  "/users/:id/invites",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { count: newCount } = z
      .object({ count: z.number().int().min(0).max(100) })
      .parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw new AppError(404, "User not found");

    await db
      .update(users)
      .set({ inviteCodesRemaining: newCount })
      .where(eq(users.id, id));

    await db.insert(moderationActions).values({
      adminUserId: req.admin!.id,
      actionType: "invite_count_changed",
      targetType: "user",
      targetId: id,
      reason: `Invite count set to ${newCount}`,
      metadata: { inviteCodesRemaining: newCount },
    });

    res.json({ success: true, data: { id, inviteCodesRemaining: newCount } });
  }),
);

// ─── Admin Invite Generation ─────────────────────────────────

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomPart = Array.from(randomBytes(6))
    .map((b) => chars[b % chars.length])
    .join("");
  return `EULESIA-${randomPart}`;
}

// POST /admin/invites/generate - Generate invite codes (admin, no limit)
router.post(
  "/invites/generate",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { count: codeCount } = z
      .object({ count: z.number().int().min(1).max(50) })
      .parse(req.body);
    const adminId = req.admin!.id;

    const generatedCodes: { id: string; code: string; createdAt: Date }[] = [];

    for (let i = 0; i < codeCount; i++) {
      let code: string = "";
      let attempts = 0;
      while (attempts < 10) {
        code = generateInviteCode();
        const [existing] = await db
          .select({ id: inviteCodes.id })
          .from(inviteCodes)
          .where(eq(inviteCodes.code, code))
          .limit(1);
        if (!existing) break;
        attempts++;
      }
      if (attempts >= 10) {
        throw new AppError(500, "Failed to generate unique invite code");
      }

      const [created] = await db
        .insert(inviteCodes)
        .values({
          code,
          createdBy: adminId,
          status: "available",
        })
        .returning();

      generatedCodes.push({
        id: created.id,
        code: created.code,
        createdAt: created.createdAt ?? new Date(),
      });
    }

    // Log action
    await db.insert(moderationActions).values({
      adminUserId: adminId,
      actionType: "invite_count_changed",
      targetType: "system",
      targetId: "admin_invite_generation",
      reason: `Admin generated ${codeCount} invite code(s)`,
      metadata: { count: codeCount, codes: generatedCodes.map((c) => c.code) },
    });

    res.status(201).json({ success: true, data: generatedCodes });
  }),
);

// GET /admin/invites - List all admin-generated invite codes
router.get(
  "/invites",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { status } = req.query;

    const conditions = [eq(inviteCodes.createdBy, req.admin!.id)];
    if (status && ["available", "used", "revoked"].includes(status as string)) {
      conditions.push(eq(inviteCodes.status, status as any));
    }

    const codes = await db
      .select({
        id: inviteCodes.id,
        code: inviteCodes.code,
        status: inviteCodes.status,
        usedAt: inviteCodes.usedAt,
        createdAt: inviteCodes.createdAt,
        usedByName: users.name,
      })
      .from(inviteCodes)
      .leftJoin(users, eq(inviteCodes.usedBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(inviteCodes.createdAt))
      .limit(100);

    res.json({
      success: true,
      data: codes.map((c) => ({
        id: c.id,
        code: c.code,
        status: c.status,
        usedAt: c.usedAt,
        createdAt: c.createdAt,
        usedBy: c.usedByName ? { name: c.usedByName } : null,
      })),
    });
  }),
);

// ─── System Announcements ───────────────────────────────────

// POST /admin/announcements - Create system announcement
router.post(
  "/announcements",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const schema = z.object({
      title: z.string().min(1).max(200),
      message: z.string().min(1).max(2000),
      type: z.enum(["info", "warning", "critical"]).default("info"),
      expiresAt: z.string().datetime().optional(),
    });
    const data = schema.parse(req.body);

    const [announcement] = await db
      .insert(systemAnnouncements)
      .values({
        title: data.title,
        message: data.message,
        type: data.type,
        createdBy: req.admin!.id,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      })
      .returning();

    await db.insert(moderationActions).values({
      adminUserId: req.admin!.id,
      actionType: "settings_changed",
      targetType: "system",
      targetId: announcement.id,
      reason: `System announcement created: ${data.title}`,
      metadata: { type: data.type },
    });

    res.status(201).json({ success: true, data: announcement });
  }),
);

// GET /admin/announcements - List all announcements
router.get(
  "/announcements",
  asyncHandler(async (_req: AdminAuthenticatedRequest, res: Response) => {
    const announcements = await db
      .select({
        id: systemAnnouncements.id,
        title: systemAnnouncements.title,
        message: systemAnnouncements.message,
        type: systemAnnouncements.type,
        active: systemAnnouncements.active,
        createdAt: systemAnnouncements.createdAt,
        expiresAt: systemAnnouncements.expiresAt,
        createdByName: adminAccounts.name,
      })
      .from(systemAnnouncements)
      .leftJoin(
        adminAccounts,
        eq(systemAnnouncements.createdBy, adminAccounts.id),
      )
      .orderBy(desc(systemAnnouncements.createdAt))
      .limit(50);

    res.json({ success: true, data: announcements });
  }),
);

// PATCH /admin/announcements/:id - Toggle announcement active status
router.patch(
  "/announcements/:id",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { active } = z.object({ active: z.boolean() }).parse(req.body);

    const [existing] = await db
      .select()
      .from(systemAnnouncements)
      .where(eq(systemAnnouncements.id, id))
      .limit(1);
    if (!existing) throw new AppError(404, "Announcement not found");

    await db
      .update(systemAnnouncements)
      .set({ active })
      .where(eq(systemAnnouncements.id, id));

    res.json({ success: true, data: { id, active } });
  }),
);

// DELETE /admin/announcements/:id - Delete announcement
router.delete(
  "/announcements/:id",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(systemAnnouncements)
      .where(eq(systemAnnouncements.id, id))
      .limit(1);
    if (!existing) throw new AppError(404, "Announcement not found");

    await db.delete(systemAnnouncements).where(eq(systemAnnouncements.id, id));

    res.json({ success: true });
  }),
);

export default router;
