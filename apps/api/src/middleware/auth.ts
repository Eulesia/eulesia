import type { Response, NextFunction } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db, sessions, users } from "../db/index.js";
import { hashToken } from "../utils/crypto.js";
import { getSessionCookieOptions } from "../utils/cookies.js";
import {
  formatBlockingSanctionResponse,
  getActiveBlockingSanction,
} from "../utils/sanctions.js";
import type { AuthenticatedRequest } from "../types/index.js";

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sessionToken = req.cookies?.session;

    if (!sessionToken) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }

    const tokenHash = hashToken(sessionToken);

    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      res.clearCookie("session", getSessionCookieOptions(req));
      res.status(401).json({ success: false, error: "Session expired" });
      return;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      res.clearCookie("session", getSessionCookieOptions(req));
      res.status(401).json({ success: false, error: "User not found" });
      return;
    }

    // Check for active bans/suspensions
    const activeSanction = await getActiveBlockingSanction(user.id);

    if (activeSanction) {
      res.status(403).json(formatBlockingSanctionResponse(activeSanction));
      return;
    }

    req.user = user;
    req.sessionId = session.id;

    // Update last seen
    await db
      .update(users)
      .set({ lastSeenAt: new Date() })
      .where(eq(users.id, user.id));

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ success: false, error: "Authentication error" });
  }
}

export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionToken = req.cookies?.session;

  if (!sessionToken) {
    next();
    return;
  }

  try {
    const tokenHash = hashToken(sessionToken);

    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      res.clearCookie("session", getSessionCookieOptions(req));
      next();
      return;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      res.clearCookie("session", getSessionCookieOptions(req));
      next();
      return;
    }

    const activeSanction = await getActiveBlockingSanction(user.id);

    if (activeSanction) {
      next();
      return;
    }

    req.user = user;
    req.sessionId = session.id;
    next();
  } catch (error) {
    console.error("Optional auth middleware error:", error);
    next();
  }
}
