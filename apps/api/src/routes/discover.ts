import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  trendingCache,
  threads,
  users,
  municipalities,
  threadTags,
  threadVotes,
} from "../db/index.js";
import { optionalAuthMiddleware } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getExploreFeed,
  getAlgorithmDocumentation,
} from "../services/trending.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();

// ============================================
// GET /discover/explore — CVS-ranked threads
// ============================================

const exploreSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
  scope: z.enum(["all", "local", "national", "european"]).default("all"),
});

router.get(
  "/explore",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const params = exploreSchema.parse(req.query);
    const userId = req.user?.id;

    // Get CVS-ranked thread IDs from the trending service
    const exploreFeed = await getExploreFeed({
      page: params.page,
      limit: params.limit,
      scope: params.scope,
    });

    if (exploreFeed.items.length === 0) {
      res.json({
        success: true,
        data: {
          items: [],
          total: exploreFeed.total,
          page: exploreFeed.page,
          limit: exploreFeed.limit,
          hasMore: exploreFeed.hasMore,
        },
      });
      return;
    }

    // Enrich with full thread data (author, municipality, tags, user vote)
    const threadIds = exploreFeed.items.map((t) => t.id);

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

    // Build a map of full thread data by ID
    const threadMap = new Map(threadList.map((t) => [t.thread.id, t]));

    // Get tags for these threads
    const tagResults =
      threadIds.length > 0
        ? await db
            .select()
            .from(threadTags)
            .where(inArray(threadTags.threadId, threadIds))
        : [];

    const tagsByThread = tagResults.reduce(
      (acc, tag) => {
        if (!acc[tag.threadId]) acc[tag.threadId] = [];
        acc[tag.threadId].push(tag.tag);
        return acc;
      },
      {} as Record<string, string[]>,
    );

    // Get user votes if logged in
    let userVotes: Record<string, number> = {};
    if (userId && threadIds.length > 0) {
      const votes = await db
        .select()
        .from(threadVotes)
        .where(
          and(
            inArray(threadVotes.threadId, threadIds),
            eq(threadVotes.userId, userId),
          ),
        );
      userVotes = votes.reduce(
        (acc, v) => {
          acc[v.threadId] = v.value;
          return acc;
        },
        {} as Record<string, number>,
      );
    }

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

    // Build response maintaining CVS sort order
    const items = exploreFeed.items
      .map((scored) => {
        const full = threadMap.get(scored.id);
        if (!full) return null;

        return {
          ...full.thread,
          authorId: full.author?.id,
          tags: tagsByThread[scored.id] || [],
          author: full.author,
          municipality: full.municipality,
          userVote: userVotes[scored.id] || 0,
          sourceInstitutionName: full.thread.sourceInstitutionId
            ? srcInstNames[full.thread.sourceInstitutionId] || null
            : null,
          cvsScore: scored.cvsScore,
          scoreBreakdown: scored.scoreBreakdown,
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      data: {
        items,
        total: exploreFeed.total,
        page: exploreFeed.page,
        limit: exploreFeed.limit,
        hasMore: exploreFeed.hasMore,
        feedScope: "explore",
      },
    });
  }),
);

// ============================================
// GET /discover/trending — Cached trending data
// ============================================

const trendingSchema = z.object({
  type: z.enum(["threads", "tags"]).default("threads"),
  limit: z.coerce.number().min(1).max(50).default(10),
});

router.get(
  "/trending",
  asyncHandler(async (req, res: Response) => {
    const params = trendingSchema.parse(req.query);

    const entityType = params.type === "threads" ? "thread" : "tag";

    const cached = await db
      .select()
      .from(trendingCache)
      .where(eq(trendingCache.entityType, entityType))
      .orderBy(desc(trendingCache.score))
      .limit(params.limit);

    res.json({
      success: true,
      data: {
        type: params.type,
        items: cached.map((entry) => ({
          entityId: entry.entityId,
          score: parseFloat(entry.score),
          metadata: entry.metadata,
          computedAt: entry.computedAt,
        })),
        computedAt: cached[0]?.computedAt || null,
      },
    });
  }),
);

// ============================================
// GET /discover/algorithm — Public documentation
// ============================================

router.get("/algorithm", (_req, res: Response) => {
  const docs = getAlgorithmDocumentation();
  res.json({
    success: true,
    data: docs,
  });
});

export default router;
