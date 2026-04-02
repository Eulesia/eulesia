import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  bookmarks,
  threads,
  users,
  municipalities,
  threadTags,
  threadVotes,
} from "../db/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();

// ============================================
// POST /bookmarks — Add bookmark
// ============================================

const addBookmarkSchema = z.object({
  threadId: z.string().uuid(),
});

router.post(
  "/",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { threadId } = addBookmarkSchema.parse(req.body);

    // Verify thread exists
    const [thread] = await db
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    // Upsert bookmark (ignore if already exists)
    await db
      .insert(bookmarks)
      .values({ userId, threadId })
      .onConflictDoNothing();

    res.status(201).json({
      success: true,
      data: { threadId, bookmarked: true },
    });
  }),
);

// ============================================
// DELETE /bookmarks/:threadId — Remove bookmark
// ============================================

router.delete(
  "/:threadId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { threadId } = req.params;

    await db
      .delete(bookmarks)
      .where(
        and(eq(bookmarks.userId, userId), eq(bookmarks.threadId, threadId)),
      );

    res.json({
      success: true,
      data: { threadId, bookmarked: false },
    });
  }),
);

// ============================================
// GET /bookmarks — List user's bookmarks
// ============================================

const listBookmarksSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

router.get(
  "/",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const params = listBookmarksSchema.parse(req.query);
    const offset = (params.page - 1) * params.limit;

    // Get bookmarked thread IDs (newest bookmarks first)
    const userBookmarks = await db
      .select({
        threadId: bookmarks.threadId,
        bookmarkedAt: bookmarks.createdAt,
      })
      .from(bookmarks)
      .where(eq(bookmarks.userId, userId))
      .orderBy(desc(bookmarks.createdAt))
      .limit(params.limit)
      .offset(offset);

    if (userBookmarks.length === 0) {
      res.json({
        success: true,
        data: {
          items: [],
          total: 0,
          page: params.page,
          limit: params.limit,
          hasMore: false,
        },
      });
      return;
    }

    const threadIds = userBookmarks.map((b) => b.threadId);

    // Get full thread data
    const threadList = await db
      .select({
        thread: threads,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
          role: users.role,
          institutionType: users.institutionType,
          institutionName: users.institutionName,
          identityVerified: users.identityVerified,
        },
        municipality: municipalities,
      })
      .from(threads)
      .leftJoin(users, eq(threads.authorId, users.id))
      .leftJoin(municipalities, eq(threads.municipalityId, municipalities.id))
      .where(inArray(threads.id, threadIds));

    const threadMap = new Map(threadList.map((t) => [t.thread.id, t]));

    // Get tags
    const allTags = await db
      .select()
      .from(threadTags)
      .where(inArray(threadTags.threadId, threadIds));

    const tagsByThread = allTags.reduce(
      (acc, tag) => {
        if (!acc[tag.threadId]) acc[tag.threadId] = [];
        acc[tag.threadId].push(tag.tag);
        return acc;
      },
      {} as Record<string, string[]>,
    );

    // Get user votes
    const votes = await db
      .select()
      .from(threadVotes)
      .where(
        and(
          inArray(threadVotes.threadId, threadIds),
          eq(threadVotes.userId, userId),
        ),
      );
    const userVotes = votes.reduce(
      (acc, v) => {
        acc[v.threadId] = v.value;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Resolve source institution names
    const sourceInstIds = [
      ...new Set(
        threadList
          .map((t) => t.thread.sourceInstitutionId)
          .filter((id): id is string => !!id),
      ),
    ];
    let srcInstNames: Record<string, string> = {};
    if (sourceInstIds.length > 0) {
      const insts = await db
        .select({ id: users.id, name: users.institutionName })
        .from(users)
        .where(inArray(users.id, sourceInstIds));
      srcInstNames = insts.reduce(
        (acc, i) => {
          if (i.name) acc[i.id] = i.name;
          return acc;
        },
        {} as Record<string, string>,
      );
    }

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookmarks)
      .where(eq(bookmarks.userId, userId));

    // Build response in bookmark order
    const items = userBookmarks
      .map((bookmark) => {
        const full = threadMap.get(bookmark.threadId);
        if (!full) return null;

        return {
          ...full.thread,
          authorId: full.author?.id,
          tags: tagsByThread[bookmark.threadId] || [],
          author: full.author,
          municipality: full.municipality,
          userVote: userVotes[bookmark.threadId] || 0,
          isBookmarked: true,
          bookmarkedAt: bookmark.bookmarkedAt,
          sourceInstitutionName: full.thread.sourceInstitutionId
            ? srcInstNames[full.thread.sourceInstitutionId] || null
            : null,
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      data: {
        items,
        total: count,
        page: params.page,
        limit: params.limit,
        hasMore: offset + userBookmarks.length < count,
      },
    });
  }),
);

export default router;
