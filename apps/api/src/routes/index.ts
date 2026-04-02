import { Router } from "express";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import { db, systemAnnouncements } from "../db/index.js";
import authRoutes from "./auth.js";
import eudiRoutes from "./eudi.js";
import userRoutes from "./users.js";
import agoraRoutes from "./agora.js";
import clubsRoutes from "./clubs.js";
import homeRoutes from "./home.js";
import mapRoutes from "./map.js";
import subscriptionsRoutes from "./subscriptions.js";
import searchRoutes from "./search.js";
import locationsRoutes from "./locations.js";
import uploadsRoutes from "./uploads.js";
import dmRoutes from "./dm.js";
import notificationsRoutes from "./notifications.js";
import adminRoutes from "./admin.js";
import adminAuthRoutes from "./admin-auth.js";
import reportsRoutes from "./reports.js";
import institutionsRoutes from "./institutions.js";
import linkPreviewRoutes from "./linkPreview.js";
import discoverRoutes from "./discover.js";
import bookmarksRoutes from "./bookmarks.js";
import waitlistRoutes from "./waitlist.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/auth/eudi", eudiRoutes);
router.use("/users", userRoutes);
router.use("/agora", agoraRoutes);
router.use("/clubs", clubsRoutes);
router.use("/home", homeRoutes);
router.use("/map", mapRoutes);
router.use("/subscriptions", subscriptionsRoutes);
router.use("/search", searchRoutes);
router.use("/locations", locationsRoutes);
router.use("/uploads", uploadsRoutes);
router.use("/dm", dmRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/admin/auth", adminAuthRoutes);
router.use("/admin", adminRoutes);
router.use("/reports", reportsRoutes);
router.use("/institutions", institutionsRoutes);
router.use("/discover", discoverRoutes);
router.use("/bookmarks", bookmarksRoutes);
router.use("/waitlist", waitlistRoutes);
router.use("/", linkPreviewRoutes);

// Public: active system announcements
router.get("/announcements", async (_req, res) => {
  try {
    const now = new Date();
    const announcements = await db
      .select({
        id: systemAnnouncements.id,
        title: systemAnnouncements.title,
        message: systemAnnouncements.message,
        type: systemAnnouncements.type,
        createdAt: systemAnnouncements.createdAt,
        expiresAt: systemAnnouncements.expiresAt,
      })
      .from(systemAnnouncements)
      .where(
        and(
          eq(systemAnnouncements.active, true),
          or(
            isNull(systemAnnouncements.expiresAt),
            gt(systemAnnouncements.expiresAt, now),
          ),
        ),
      )
      .orderBy(systemAnnouncements.createdAt);

    res.json({ success: true, data: announcements });
  } catch {
    res.json({ success: true, data: [] });
  }
});

// Health check
router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
