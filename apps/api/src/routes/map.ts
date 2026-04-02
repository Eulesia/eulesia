import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, gte, lte, sql, desc, inArray } from "drizzle-orm";
import {
  db,
  places,
  municipalities,
  threads,
  clubs,
  users,
  threadTags,
} from "../db/index.js";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();

// Validation schemas
const boundsSchema = z.object({
  north: z.coerce.number().min(-90).max(90),
  south: z.coerce.number().min(-90).max(90),
  east: z.coerce.number().min(-180).max(180),
  west: z.coerce.number().min(-180).max(180),
  types: z.string().optional(), // "agora,clubs,places,municipalities"
  categories: z.string().optional(), // "park,trail,landmark"
  timePreset: z.enum(["week", "month", "year", "all"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  scope: z.string().optional(), // "local,national"
  language: z.string().optional(), // "fi,en"
  tags: z.string().optional(), // "koulutus,liikenne"
});

const createPlaceSchema = z.object({
  name: z.string().min(2).max(255),
  nameFi: z.string().max(255).optional(),
  nameSv: z.string().max(255).optional(),
  description: z.string().max(5000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().min(0).max(1000).optional(),
  geojson: z.any().optional(),
  type: z.enum(["poi", "area", "route", "landmark"]),
  category: z.string().max(100).optional(),
  municipalityId: z.string().uuid().optional(),
});

const placesFilterSchema = z.object({
  type: z.enum(["poi", "area", "route", "landmark"]).optional(),
  category: z.string().optional(),
  municipalityId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

// GET /map/points - Get map points within bounds
router.get(
  "/points",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const bounds = boundsSchema.parse(req.query);
    const requestedTypes = bounds.types?.split(",") || [
      "agora",
      "clubs",
      "places",
      "municipalities",
    ];
    const requestedCategories = bounds.categories?.split(",") || [];
    const requestedScopes = bounds.scope?.split(",") || [];
    const requestedLanguages = bounds.language?.split(",") || [];
    const requestedTags = bounds.tags?.split(",") || [];

    // Time filter calculation
    let effectiveDateFrom: Date | undefined;
    let effectiveDateTo: Date | undefined;
    if (bounds.timePreset && bounds.timePreset !== "all") {
      effectiveDateTo = new Date();
      const ms =
        { week: 7, month: 30, year: 365 }[bounds.timePreset]! * 86400000;
      effectiveDateFrom = new Date(Date.now() - ms);
    }
    // dateFrom/dateTo override preset if provided
    if (bounds.dateFrom) effectiveDateFrom = new Date(bounds.dateFrom);
    if (bounds.dateTo) effectiveDateTo = new Date(bounds.dateTo);

    interface MapPoint {
      id: string;
      type: "municipality" | "place" | "thread" | "club";
      name: string;
      latitude: number;
      longitude: number;
      meta: {
        threadCount?: number;
        memberCount?: number;
        category?: string;
        scope?: string;
        placeType?: string;
        language?: string;
        createdAt?: string;
      };
    }

    const points: MapPoint[] = [];

    // Get municipalities with coordinates in bounds (NO time filter - permanent entities)
    if (requestedTypes.includes("municipalities")) {
      const municipalityPoints = await db
        .select({
          id: municipalities.id,
          name: municipalities.name,
          latitude: municipalities.latitude,
          longitude: municipalities.longitude,
        })
        .from(municipalities)
        .where(
          and(
            gte(municipalities.latitude, bounds.south.toString()),
            lte(municipalities.latitude, bounds.north.toString()),
            gte(municipalities.longitude, bounds.west.toString()),
            lte(municipalities.longitude, bounds.east.toString()),
          ),
        )
        .limit(200);

      // Get thread counts for each municipality
      const municipalityIds = municipalityPoints.map((m) => m.id);
      let threadCounts: Record<string, number> = {};

      if (municipalityIds.length > 0) {
        const counts = await db
          .select({
            municipalityId: threads.municipalityId,
            count: sql<number>`count(*)::int`,
          })
          .from(threads)
          .where(inArray(threads.municipalityId, municipalityIds))
          .groupBy(threads.municipalityId);

        threadCounts = counts.reduce(
          (acc, c) => {
            if (c.municipalityId) acc[c.municipalityId] = c.count;
            return acc;
          },
          {} as Record<string, number>,
        );
      }

      for (const m of municipalityPoints) {
        if (m.latitude && m.longitude) {
          points.push({
            id: m.id,
            type: "municipality",
            name: m.name,
            latitude: parseFloat(m.latitude),
            longitude: parseFloat(m.longitude),
            meta: {
              threadCount: threadCounts[m.id] || 0,
            },
          });
        }
      }
    }

    // Get places in bounds
    if (requestedTypes.includes("places")) {
      const placeConditions = [
        gte(places.latitude, bounds.south.toString()),
        lte(places.latitude, bounds.north.toString()),
        gte(places.longitude, bounds.west.toString()),
        lte(places.longitude, bounds.east.toString()),
      ];

      if (effectiveDateFrom)
        placeConditions.push(gte(places.createdAt, effectiveDateFrom));
      if (effectiveDateTo)
        placeConditions.push(lte(places.createdAt, effectiveDateTo));

      const placePoints = await db
        .select({
          id: places.id,
          name: places.name,
          latitude: places.latitude,
          longitude: places.longitude,
          type: places.type,
          category: places.category,
          createdAt: places.createdAt,
        })
        .from(places)
        .where(and(...placeConditions))
        .limit(500);

      for (const p of placePoints) {
        if (p.latitude && p.longitude) {
          // Filter by category if specified
          if (
            requestedCategories.length > 0 &&
            p.category &&
            !requestedCategories.includes(p.category)
          ) {
            continue;
          }

          points.push({
            id: p.id,
            type: "place",
            name: p.name,
            latitude: parseFloat(p.latitude),
            longitude: parseFloat(p.longitude),
            meta: {
              category: p.category || undefined,
              placeType: p.type,
              createdAt: p.createdAt?.toISOString(),
            },
          });
        }
      }
    }

    // Get threads with coordinates
    if (requestedTypes.includes("agora")) {
      const threadConditions = [
        gte(threads.latitude, bounds.south.toString()),
        lte(threads.latitude, bounds.north.toString()),
        gte(threads.longitude, bounds.west.toString()),
        lte(threads.longitude, bounds.east.toString()),
      ];

      if (effectiveDateFrom)
        threadConditions.push(gte(threads.createdAt, effectiveDateFrom));
      if (effectiveDateTo)
        threadConditions.push(lte(threads.createdAt, effectiveDateTo));
      if (requestedScopes.length > 0)
        threadConditions.push(
          inArray(
            threads.scope,
            requestedScopes as ("local" | "national" | "european")[],
          ),
        );
      if (requestedLanguages.length > 0)
        threadConditions.push(inArray(threads.language, requestedLanguages));

      // Tag filter using EXISTS subquery to avoid JOIN multiplication
      if (requestedTags.length > 0) {
        threadConditions.push(
          sql`EXISTS (SELECT 1 FROM ${threadTags} WHERE ${threadTags.threadId} = ${threads.id} AND ${threadTags.tag} = ANY(${requestedTags}))`,
        );
      }

      const threadPoints = await db
        .select({
          id: threads.id,
          title: threads.title,
          latitude: threads.latitude,
          longitude: threads.longitude,
          scope: threads.scope,
          language: threads.language,
          createdAt: threads.createdAt,
        })
        .from(threads)
        .where(and(...threadConditions))
        .limit(500);

      for (const t of threadPoints) {
        if (t.latitude && t.longitude) {
          points.push({
            id: t.id,
            type: "thread",
            name: t.title,
            latitude: parseFloat(t.latitude),
            longitude: parseFloat(t.longitude),
            meta: {
              scope: t.scope,
              language: t.language || undefined,
              createdAt: t.createdAt?.toISOString(),
            },
          });
        }
      }
    }

    // Get clubs with coordinates
    if (requestedTypes.includes("clubs")) {
      const clubConditions = [
        gte(clubs.latitude, bounds.south.toString()),
        lte(clubs.latitude, bounds.north.toString()),
        gte(clubs.longitude, bounds.west.toString()),
        lte(clubs.longitude, bounds.east.toString()),
      ];

      if (effectiveDateFrom)
        clubConditions.push(gte(clubs.createdAt, effectiveDateFrom));
      if (effectiveDateTo)
        clubConditions.push(lte(clubs.createdAt, effectiveDateTo));

      const clubPoints = await db
        .select({
          id: clubs.id,
          name: clubs.name,
          latitude: clubs.latitude,
          longitude: clubs.longitude,
          category: clubs.category,
          memberCount: clubs.memberCount,
          createdAt: clubs.createdAt,
        })
        .from(clubs)
        .where(and(...clubConditions))
        .limit(300);

      for (const c of clubPoints) {
        if (c.latitude && c.longitude) {
          points.push({
            id: c.id,
            type: "club",
            name: c.name,
            latitude: parseFloat(c.latitude),
            longitude: parseFloat(c.longitude),
            meta: {
              memberCount: c.memberCount || 0,
              category: c.category || undefined,
              createdAt: c.createdAt?.toISOString(),
            },
          });
        }
      }
    }

    res.json({
      success: true,
      data: { points },
    });
  }),
);

// GET /map/location/:type/:id - Get location details with content
router.get(
  "/location/:type/:id",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { type, id } = req.params;

    if (type === "municipality") {
      const [municipality] = await db
        .select()
        .from(municipalities)
        .where(eq(municipalities.id, id))
        .limit(1);

      if (!municipality) {
        throw new AppError(404, "Municipality not found");
      }

      // Get recent threads for this municipality
      const recentThreads = await db
        .select({
          thread: threads,
          author: {
            id: users.id,
            name: users.name,
            avatarUrl: users.avatarUrl,
            role: users.role,
          },
        })
        .from(threads)
        .leftJoin(users, eq(threads.authorId, users.id))
        .where(eq(threads.municipalityId, id))
        .orderBy(desc(threads.createdAt))
        .limit(10);

      // Get clubs in this municipality
      const municipalityClubs = await db
        .select()
        .from(clubs)
        .where(eq(clubs.municipalityId, id))
        .limit(10);

      res.json({
        success: true,
        data: {
          ...municipality,
          threads: recentThreads.map((t) => ({
            ...t.thread,
            authorId: t.author?.id,
            author: t.author,
          })),
          clubs: municipalityClubs,
        },
      });
    } else if (type === "place") {
      const [place] = await db
        .select({
          place: places,
          municipality: municipalities,
        })
        .from(places)
        .leftJoin(municipalities, eq(places.municipalityId, municipalities.id))
        .where(eq(places.id, id))
        .limit(1);

      if (!place) {
        throw new AppError(404, "Place not found");
      }

      // Get threads at this place
      const placeThreads = await db
        .select({
          thread: threads,
          author: {
            id: users.id,
            name: users.name,
            avatarUrl: users.avatarUrl,
            role: users.role,
          },
        })
        .from(threads)
        .leftJoin(users, eq(threads.authorId, users.id))
        .where(eq(threads.placeId, id))
        .orderBy(desc(threads.createdAt))
        .limit(10);

      // Get clubs at this place
      const placeClubs = await db
        .select()
        .from(clubs)
        .where(eq(clubs.placeId, id))
        .limit(10);

      res.json({
        success: true,
        data: {
          ...place.place,
          municipality: place.municipality,
          threads: placeThreads.map((t) => ({
            ...t.thread,
            authorId: t.author?.id,
            author: t.author,
          })),
          clubs: placeClubs,
        },
      });
    } else if (type === "thread") {
      const [thread] = await db
        .select({
          thread: threads,
          author: {
            id: users.id,
            name: users.name,
            avatarUrl: users.avatarUrl,
            role: users.role,
          },
          municipality: municipalities,
          place: places,
        })
        .from(threads)
        .leftJoin(users, eq(threads.authorId, users.id))
        .leftJoin(municipalities, eq(threads.municipalityId, municipalities.id))
        .leftJoin(places, eq(threads.placeId, places.id))
        .where(eq(threads.id, id))
        .limit(1);

      if (!thread) {
        throw new AppError(404, "Thread not found");
      }

      // Get tags
      const tags = await db
        .select({ tag: threadTags.tag })
        .from(threadTags)
        .where(eq(threadTags.threadId, id));

      res.json({
        success: true,
        data: {
          ...thread.thread,
          authorId: thread.author?.id,
          tags: tags.map((t) => t.tag),
          author: thread.author,
          municipality: thread.municipality,
          place: thread.place,
        },
      });
    } else if (type === "club") {
      const [club] = await db
        .select({
          club: clubs,
          place: places,
          municipality: municipalities,
        })
        .from(clubs)
        .leftJoin(places, eq(clubs.placeId, places.id))
        .leftJoin(municipalities, eq(clubs.municipalityId, municipalities.id))
        .where(eq(clubs.id, id))
        .limit(1);

      if (!club) {
        throw new AppError(404, "Club not found");
      }

      res.json({
        success: true,
        data: {
          ...club.club,
          place: club.place,
          municipality: club.municipality,
        },
      });
    } else {
      throw new AppError(400, "Invalid location type");
    }
  }),
);

// GET /places - List and search places
router.get(
  "/places",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const filters = placesFilterSchema.parse(req.query);
    const offset = (filters.page - 1) * filters.limit;

    const conditions = [];

    if (filters.type) {
      conditions.push(eq(places.type, filters.type));
    }

    if (filters.category) {
      conditions.push(eq(places.category, filters.category));
    }

    if (filters.municipalityId) {
      conditions.push(eq(places.municipalityId, filters.municipalityId));
    }

    if (filters.search) {
      conditions.push(sql`(
      ${places.name} ILIKE ${"%" + filters.search + "%"} OR
      ${places.nameFi} ILIKE ${"%" + filters.search + "%"} OR
      ${places.nameSv} ILIKE ${"%" + filters.search + "%"}
    )`);
    }

    const placeList = await db
      .select({
        place: places,
        municipality: municipalities,
      })
      .from(places)
      .leftJoin(municipalities, eq(places.municipalityId, municipalities.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(places.name)
      .limit(filters.limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(places)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({
      success: true,
      data: {
        items: placeList.map((p) => ({
          ...p.place,
          municipality: p.municipality,
        })),
        total: count,
        page: filters.page,
        limit: filters.limit,
        hasMore: offset + placeList.length < count,
      },
    });
  }),
);

// POST /places - Create a new place
router.post(
  "/places",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const data = createPlaceSchema.parse(req.body);

    // Create place
    const [newPlace] = await db
      .insert(places)
      .values({
        name: data.name,
        nameFi: data.nameFi,
        nameSv: data.nameSv,
        description: data.description,
        latitude: data.latitude?.toString(),
        longitude: data.longitude?.toString(),
        radiusKm: data.radiusKm?.toString(),
        geojson: data.geojson,
        type: data.type,
        category: data.category,
        municipalityId: data.municipalityId,
        createdBy: userId,
      })
      .returning();

    res.status(201).json({
      success: true,
      data: newPlace,
    });
  }),
);

// GET /places/categories - Get all place categories
router.get(
  "/places/categories",
  asyncHandler(async (_req, res: Response) => {
    const categories = await db
      .select({
        category: places.category,
        count: sql<number>`count(*)::int`,
      })
      .from(places)
      .where(sql`${places.category} IS NOT NULL`)
      .groupBy(places.category)
      .orderBy(desc(sql`count(*)`));

    res.json({
      success: true,
      data: categories.filter((c) => c.category !== null),
    });
  }),
);

// GET /municipalities - Get all municipalities with coordinates
router.get(
  "/municipalities",
  asyncHandler(async (_req, res: Response) => {
    const municipalityList = await db
      .select()
      .from(municipalities)
      .orderBy(municipalities.name);

    res.json({
      success: true,
      data: municipalityList,
    });
  }),
);

export default router;
