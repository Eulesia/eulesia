/**
 * Upload Routes
 *
 * Handles file uploads for avatars and content images.
 */

import { Router } from "express";
import multer from "multer";
import { db, users } from "../db/index.js";
import { eq } from "drizzle-orm";
import {
  processAvatar,
  processContentImage,
  deleteUpload,
  getStorageStats,
} from "../services/uploads.js";
import { authMiddleware } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();

// Configure multer for memory storage (we process in memory before saving)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Allowed: JPEG, PNG, WebP, GIF"));
    }
  },
});

/**
 * Upload avatar image
 * POST /uploads/avatar
 */
router.post(
  "/avatar",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;

      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      // Process and save avatar
      const result = await processAvatar(req.file.buffer, user.id);

      // Delete old avatar if exists
      const existingUser = await db
        .select({ avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      if (existingUser[0]?.avatarUrl) {
        await deleteUpload(existingUser[0].avatarUrl);
      }

      // Update user's avatar URL
      await db
        .update(users)
        .set({ avatarUrl: result.url, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return res.json({
        success: true,
        avatarUrl: result.url,
      });
    } catch (error) {
      console.error("Avatar upload error:", error);
      return res.status(500).json({ error: "Failed to upload avatar" });
    }
  },
);

/**
 * Upload content image (for threads, comments)
 * POST /uploads/image
 */
router.post(
  "/image",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;

      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      // Process and save image
      const result = await processContentImage(req.file.buffer, user.id);

      return res.json({
        success: true,
        url: result.url,
        thumbnailUrl: result.thumbnailUrl,
        width: result.width,
        height: result.height,
      });
    } catch (error) {
      console.error("Image upload error:", error);
      return res.status(500).json({ error: "Failed to upload image" });
    }
  },
);

/**
 * Delete avatar
 * DELETE /uploads/avatar
 */
router.delete("/avatar", authMiddleware, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get current avatar URL
    const existingUser = await db
      .select({ avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (existingUser[0]?.avatarUrl) {
      await deleteUpload(existingUser[0].avatarUrl);
    }

    // Clear avatar URL
    await db
      .update(users)
      .set({ avatarUrl: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return res.json({ success: true });
  } catch (error) {
    console.error("Avatar delete error:", error);
    return res.status(500).json({ error: "Failed to delete avatar" });
  }
});

/**
 * Get storage statistics (admin only)
 * GET /uploads/stats
 */
router.get("/stats", authMiddleware, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;

    if (!user || user.role !== "admin") {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const stats = await getStorageStats();
    return res.json(stats);
  } catch (error) {
    console.error("Storage stats error:", error);
    return res.status(500).json({ error: "Failed to get storage stats" });
  }
});

export default router;
