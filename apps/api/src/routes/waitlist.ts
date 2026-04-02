import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { eq, and, count, desc } from "drizzle-orm";
import { db, waitlist, inviteCodes, users } from "../db/index.js";
import { adminAuthMiddleware } from "../middleware/adminAuth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { emailService } from "../services/email.js";
import { randomBytes } from "crypto";
import type { AdminAuthenticatedRequest } from "../types/index.js";

const router = Router();

// ─── Helpers ────────────────────────────────────────

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomPart = Array.from(randomBytes(6))
    .map((b) => chars[b % chars.length])
    .join("");
  return `EULESIA-${randomPart}`;
}

// ─── Public routes ──────────────────────────────────

const joinWaitlistSchema = z.object({
  email: z
    .string()
    .email()
    .max(255)
    .transform((s) => s.toLowerCase()),
  name: z.string().max(255).optional(),
  locale: z.enum(["fi", "en"]).default("en"),
});

// POST /waitlist/join — Join the waitlist (public, rate-limited)
router.post(
  "/join",
  asyncHandler(async (req: Request, res: Response) => {
    const { email, name, locale } = joinWaitlistSchema.parse(req.body);

    // Generic message to prevent email enumeration
    const genericMsg =
      "If this email is not already registered, you have been added to the waitlist.";

    // Check if email already in waitlist
    const [existing] = await db
      .select({ id: waitlist.id, status: waitlist.status })
      .from(waitlist)
      .where(eq(waitlist.email, email))
      .limit(1);

    if (existing) {
      res.json({ success: true, data: { message: genericMsg } });
      return;
    }

    // Check if email already belongs to a registered user
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      res.json({ success: true, data: { message: genericMsg } });
      return;
    }

    // Count current queue position
    const [countResult] = await db.select({ count: count() }).from(waitlist);
    const position = (countResult?.count ?? 0) + 1;

    // Insert
    await db.insert(waitlist).values({
      email,
      name: name || null,
      locale,
      ipAddress: req.ip || null,
    });

    res.status(201).json({
      success: true,
      data: { message: genericMsg, position },
    });
  }),
);

// ─── Admin routes ───────────────────────────────────

// GET /waitlist/admin/stats — Dashboard stats
router.get(
  "/admin/stats",
  adminAuthMiddleware,
  asyncHandler(async (_req: AdminAuthenticatedRequest, res: Response) => {
    const [pending] = await db
      .select({ count: count() })
      .from(waitlist)
      .where(eq(waitlist.status, "pending"));
    const [approved] = await db
      .select({ count: count() })
      .from(waitlist)
      .where(eq(waitlist.status, "approved"));
    const [rejected] = await db
      .select({ count: count() })
      .from(waitlist)
      .where(eq(waitlist.status, "rejected"));
    const [total] = await db.select({ count: count() }).from(waitlist);

    res.json({
      success: true,
      data: {
        pending: pending.count,
        approved: approved.count,
        rejected: rejected.count,
        total: total.count,
      },
    });
  }),
);

// GET /waitlist/admin — List waitlist entries (paginated, filterable)
router.get(
  "/admin",
  adminAuthMiddleware,
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { page = "1", limit = "20", status } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(
      100,
      Math.max(1, parseInt(limit as string) || 20),
    );
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (
      status &&
      ["pending", "approved", "rejected"].includes(status as string)
    ) {
      conditions.push(
        eq(waitlist.status, status as "pending" | "approved" | "rejected"),
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(waitlist)
      .where(whereClause);

    const entries = await db
      .select({
        id: waitlist.id,
        email: waitlist.email,
        name: waitlist.name,
        status: waitlist.status,
        locale: waitlist.locale,
        createdAt: waitlist.createdAt,
        approvedAt: waitlist.approvedAt,
        rejectedAt: waitlist.rejectedAt,
        emailSentAt: waitlist.emailSentAt,
        note: waitlist.note,
      })
      .from(waitlist)
      .where(whereClause)
      .orderBy(desc(waitlist.createdAt))
      .limit(limitNum)
      .offset(offset);

    res.json({
      success: true,
      data: {
        items: entries,
        total: totalResult.count,
        page: pageNum,
        limit: limitNum,
        hasMore: offset + limitNum < (totalResult.count as number),
      },
    });
  }),
);

// POST /waitlist/admin/:id/approve — Approve entry, generate invite code, send email
router.post(
  "/admin/:id/approve",
  adminAuthMiddleware,
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const adminId = req.admin!.id;

    const [entry] = await db
      .select()
      .from(waitlist)
      .where(eq(waitlist.id, id))
      .limit(1);
    if (!entry) {
      res
        .status(404)
        .json({ success: false, error: "Waitlist entry not found" });
      return;
    }
    if (entry.status !== "pending") {
      res
        .status(400)
        .json({ success: false, error: "Entry already processed" });
      return;
    }

    // Generate unique invite code
    let code = "";
    for (let attempts = 0; attempts < 10; attempts++) {
      code = generateInviteCode();
      const [existing] = await db
        .select({ id: inviteCodes.id })
        .from(inviteCodes)
        .where(eq(inviteCodes.code, code))
        .limit(1);
      if (!existing) break;
    }

    // Transaction: create invite code + update waitlist entry
    await db.transaction(async (tx) => {
      const [newCode] = await tx
        .insert(inviteCodes)
        .values({
          code,
          createdBy: adminId,
          status: "available",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        })
        .returning();

      await tx
        .update(waitlist)
        .set({
          status: "approved",
          inviteCodeId: newCode.id,
          approvedBy: adminId,
          approvedAt: new Date(),
        })
        .where(eq(waitlist.id, id));
    });

    // Send email with invite code
    const emailSent = await emailService.sendWaitlistApproval(
      entry.email,
      code,
      entry.locale || "en",
    );

    if (emailSent) {
      await db
        .update(waitlist)
        .set({ emailSentAt: new Date() })
        .where(eq(waitlist.id, id));
    }

    res.json({
      success: true,
      data: { id, status: "approved", code, emailSent },
    });
  }),
);

// POST /waitlist/admin/:id/reject — Reject entry
router.post(
  "/admin/:id/reject",
  adminAuthMiddleware,
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { note } = z
      .object({ note: z.string().max(1000).optional() })
      .parse(req.body);

    const [entry] = await db
      .select()
      .from(waitlist)
      .where(eq(waitlist.id, id))
      .limit(1);
    if (!entry) {
      res
        .status(404)
        .json({ success: false, error: "Waitlist entry not found" });
      return;
    }
    if (entry.status !== "pending") {
      res
        .status(400)
        .json({ success: false, error: "Entry already processed" });
      return;
    }

    await db
      .update(waitlist)
      .set({
        status: "rejected",
        rejectedBy: req.admin!.id,
        rejectedAt: new Date(),
        note: note || null,
      })
      .where(eq(waitlist.id, id));

    res.json({ success: true, data: { id, status: "rejected" } });
  }),
);

// POST /waitlist/admin/bulk-approve — Bulk approve entries
router.post(
  "/admin/bulk-approve",
  adminAuthMiddleware,
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { ids } = z
      .object({ ids: z.array(z.string().uuid()).min(1).max(50) })
      .parse(req.body);
    const adminId = req.admin!.id;

    const results: { id: string; code: string; emailSent: boolean }[] = [];

    for (const id of ids) {
      const [entry] = await db
        .select()
        .from(waitlist)
        .where(and(eq(waitlist.id, id), eq(waitlist.status, "pending")))
        .limit(1);
      if (!entry) continue;

      const code = generateInviteCode();

      await db.transaction(async (tx) => {
        const [newCode] = await tx
          .insert(inviteCodes)
          .values({
            code,
            createdBy: adminId,
            status: "available",
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          })
          .returning();

        await tx
          .update(waitlist)
          .set({
            status: "approved",
            inviteCodeId: newCode.id,
            approvedBy: adminId,
            approvedAt: new Date(),
          })
          .where(eq(waitlist.id, id));
      });

      const emailSent = await emailService.sendWaitlistApproval(
        entry.email,
        code,
        entry.locale || "en",
      );
      if (emailSent) {
        await db
          .update(waitlist)
          .set({ emailSentAt: new Date() })
          .where(eq(waitlist.id, id));
      }

      results.push({ id, code, emailSent });
    }

    res.json({ success: true, data: { processed: results.length, results } });
  }),
);

export default router;
