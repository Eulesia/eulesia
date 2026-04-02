import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, adminAccounts, adminSessions } from "../db/index.js";
import { verifyPassword, hashPassword } from "../utils/crypto.js";
import { generateSessionToken } from "../utils/crypto.js";
import { getAdminSessionCookieOptions } from "../utils/cookies.js";
import { adminAuthMiddleware } from "../middleware/adminAuth.js";
import type { AdminAuthenticatedRequest } from "../types/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// POST /admin/auth/login
router.post(
  "/login",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
      res
        .status(400)
        .json({ success: false, error: "Username and password required" });
      return;
    }

    const [admin] = await db
      .select()
      .from(adminAccounts)
      .where(eq(adminAccounts.username, username.toLowerCase()))
      .limit(1);

    if (!admin) {
      res.status(401).json({ success: false, error: "Invalid credentials" });
      return;
    }

    const valid = await verifyPassword(admin.passwordHash, password);
    if (!valid) {
      res.status(401).json({ success: false, error: "Invalid credentials" });
      return;
    }

    const { token, hash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.insert(adminSessions).values({
      adminId: admin.id,
      tokenHash: hash,
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
      expiresAt,
    });

    res.cookie("admin_session", token, {
      ...getAdminSessionCookieOptions(req),
      expires: expiresAt,
    });

    res.json({
      success: true,
      data: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        name: admin.name,
      },
    });
  }),
);

// POST /admin/auth/logout
router.post(
  "/logout",
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const sessionToken = req.cookies?.admin_session;
    if (sessionToken) {
      const { hashToken } = await import("../utils/crypto.js");
      const tokenHash = hashToken(sessionToken);
      await db
        .delete(adminSessions)
        .where(eq(adminSessions.tokenHash, tokenHash));
    }
    res.clearCookie("admin_session", getAdminSessionCookieOptions(req));
    res.json({ success: true });
  }),
);

// GET /admin/auth/me
router.get(
  "/me",
  adminAuthMiddleware,
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    res.json({
      success: true,
      data: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        name: admin.name,
      },
    });
  }),
);

// POST /admin/auth/change-password
router.post(
  "/change-password",
  adminAuthMiddleware,
  asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res
        .status(400)
        .json({ success: false, error: "Current and new password required" });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters",
      });
      return;
    }

    const admin = req.admin!;
    const valid = await verifyPassword(admin.passwordHash, currentPassword);
    if (!valid) {
      res
        .status(401)
        .json({ success: false, error: "Current password is incorrect" });
      return;
    }

    const newHash = await hashPassword(newPassword);
    await db
      .update(adminAccounts)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(adminAccounts.id, admin.id));

    res.json({ success: true });
  }),
);

export default router;
