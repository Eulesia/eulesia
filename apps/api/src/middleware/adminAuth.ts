import type { Response, NextFunction } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db, adminSessions, adminAccounts } from "../db/index.js";
import { hashToken } from "../utils/crypto.js";
import { getAdminSessionCookieOptions } from "../utils/cookies.js";
import type { AdminAuthenticatedRequest } from "../types/index.js";

export async function adminAuthMiddleware(
  req: AdminAuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sessionToken = req.cookies?.admin_session;

    if (!sessionToken) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }

    const tokenHash = hashToken(sessionToken);

    const [session] = await db
      .select()
      .from(adminSessions)
      .where(
        and(
          eq(adminSessions.tokenHash, tokenHash),
          gt(adminSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      res.clearCookie("admin_session", getAdminSessionCookieOptions(req));
      res.status(401).json({ success: false, error: "Session expired" });
      return;
    }

    const [admin] = await db
      .select()
      .from(adminAccounts)
      .where(eq(adminAccounts.id, session.adminId))
      .limit(1);

    if (!admin) {
      res.clearCookie("admin_session", getAdminSessionCookieOptions(req));
      res.status(401).json({ success: false, error: "Admin not found" });
      return;
    }

    req.admin = admin;
    req.adminSessionId = session.id;

    // Update last seen
    await db
      .update(adminAccounts)
      .set({ lastSeenAt: new Date() })
      .where(eq(adminAccounts.id, admin.id));

    next();
  } catch (error) {
    console.error("Admin auth middleware error:", error);
    res.status(500).json({ success: false, error: "Authentication error" });
  }
}
