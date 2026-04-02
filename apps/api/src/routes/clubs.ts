import { Router, type Response } from "express";
import { z } from "zod";
import { eq, desc, and, or, sql, inArray, ilike } from "drizzle-orm";
import {
  db,
  clubs,
  clubMembers,
  clubThreads,
  clubComments,
  clubThreadVotes,
  clubCommentVotes,
  clubInvitations,
  users,
} from "../db/index.js";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { renderMarkdown } from "../utils/markdown.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { notify } from "../services/notify.js";
import { indexClub } from "../services/search/index.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();

// Validation schemas
const createClubSchema = z.object({
  name: z.string().min(3).max(255),
  slug: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(5000).optional(),
  rules: z.array(z.string().max(500)).max(10).optional(),
  category: z.string().max(100).optional(),
  coverImageUrl: z.string().url().max(500).optional(),
  isPublic: z.boolean().default(true),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  address: z.string().max(500).optional(),
  municipalityId: z.string().uuid().optional(),
});

const updateClubSchema = z.object({
  name: z.string().min(3).max(255).optional(),
  description: z.string().max(5000).optional(),
  rules: z.array(z.string().max(500)).max(10).optional(),
  category: z.string().max(100).optional(),
  coverImageUrl: z.string().url().max(500).nullable().optional(),
  isPublic: z.boolean().optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  municipalityId: z.string().uuid().nullable().optional(),
});

const createClubThreadSchema = z.object({
  title: z.string().min(5).max(500),
  content: z.string().min(10).max(50000),
  language: z.string().max(10).optional(),
});

const createClubCommentSchema = z.object({
  content: z.string().min(1).max(10000),
  parentId: z.string().uuid().optional(),
  language: z.string().max(10).optional(),
});

const clubVoteSchema = z.object({
  value: z.number().int().min(-1).max(1),
});

// GET /clubs - List clubs (public + user's closed clubs)
router.get(
  "/",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      page = "1",
      limit = "20",
      membership,
      search,
      category,
    } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    // Get user's club memberships first (if logged in)
    let memberClubIds: string[] = [];
    let memberships: Record<string, boolean> = {};
    if (req.user) {
      const userMemberships = await db
        .select({ clubId: clubMembers.clubId })
        .from(clubMembers)
        .where(eq(clubMembers.userId, req.user.id));

      memberClubIds = userMemberships.map((m) => m.clubId);
      memberships = userMemberships.reduce(
        (acc, m) => {
          acc[m.clubId] = true;
          return acc;
        },
        {} as Record<string, boolean>,
      );
    }

    // If membership=mine, only return user's clubs
    const conditions = [];
    if (membership === "mine" && memberClubIds.length > 0) {
      conditions.push(inArray(clubs.id, memberClubIds));
    } else if (membership === "mine") {
      // Not logged in or no memberships — return empty
      res.json({
        success: true,
        data: {
          items: [],
          total: 0,
          page: pageNum,
          limit: limitNum,
          hasMore: false,
        },
      });
      return;
    } else {
      // Show public clubs + closed clubs where user is a member
      conditions.push(
        memberClubIds.length > 0
          ? or(eq(clubs.isPublic, true), inArray(clubs.id, memberClubIds))!
          : eq(clubs.isPublic, true),
      );
    }

    // Search filter: match name or description
    if (search && typeof search === "string" && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(clubs.name, searchTerm),
          ilike(clubs.description, searchTerm),
        )!,
      );
    }

    // Category filter
    if (category && typeof category === "string" && category.trim()) {
      conditions.push(eq(clubs.category, category.trim()));
    }

    const whereCondition =
      conditions.length > 1 ? and(...conditions) : conditions[0];

    const clubList = await db
      .select({
        club: clubs,
        creator: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(clubs)
      .leftJoin(users, eq(clubs.creatorId, users.id))
      .where(whereCondition!)
      .orderBy(desc(clubs.memberCount))
      .limit(limitNum)
      .offset(offset);

    // Get total count with same condition
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(clubs)
      .where(whereCondition!);

    res.json({
      success: true,
      data: {
        items: clubList.map(({ club, creator }) => ({
          ...club,
          creator,
          isMember: memberships[club.id] || false,
        })),
        total: count,
        page: pageNum,
        limit: limitNum,
        hasMore: offset + clubList.length < count,
      },
    });
  }),
);

// ─── Routes that must be registered before /:id parameterized routes ───

// GET /clubs/my-invitations - Get current user's pending club invitations
router.get(
  "/my-invitations",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;

    const invitations = await db
      .select({
        id: clubInvitations.id,
        status: clubInvitations.status,
        createdAt: clubInvitations.createdAt,
        club: {
          id: clubs.id,
          name: clubs.name,
          slug: clubs.slug,
          coverImageUrl: clubs.coverImageUrl,
          memberCount: clubs.memberCount,
        },
        inviter: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(clubInvitations)
      .innerJoin(clubs, eq(clubInvitations.clubId, clubs.id))
      .innerJoin(users, eq(clubInvitations.inviterId, users.id))
      .where(
        and(
          eq(clubInvitations.inviteeId, userId),
          eq(clubInvitations.status, "pending"),
        ),
      )
      .orderBy(desc(clubInvitations.createdAt));

    res.json({ success: true, data: invitations });
  }),
);

// POST /clubs/invitations/:invitationId/accept - Accept club invitation
router.post(
  "/invitations/:invitationId/accept",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { invitationId } = req.params;

    const { invitation, clubName } = await db.transaction(async (tx) => {
      const [invitation] = await tx
        .update(clubInvitations)
        .set({ status: "accepted" })
        .where(
          and(
            eq(clubInvitations.id, invitationId),
            eq(clubInvitations.inviteeId, userId),
            eq(clubInvitations.status, "pending"),
          ),
        )
        .returning();

      if (!invitation) throw new AppError(404, "Invitation not found");

      const [existingMember] = await tx
        .select({ userId: clubMembers.userId })
        .from(clubMembers)
        .where(
          and(
            eq(clubMembers.clubId, invitation.clubId),
            eq(clubMembers.userId, userId),
          ),
        )
        .limit(1);

      if (!existingMember) {
        await tx.insert(clubMembers).values({
          clubId: invitation.clubId,
          userId,
          role: "member",
        });

        await tx
          .update(clubs)
          .set({ memberCount: sql`${clubs.memberCount} + 1` })
          .where(eq(clubs.id, invitation.clubId));
      }

      const [club] = await tx
        .select({ name: clubs.name })
        .from(clubs)
        .where(eq(clubs.id, invitation.clubId))
        .limit(1);

      return { invitation, clubName: club?.name || "" };
    });

    await notify({
      userId: invitation.inviterId,
      type: "club_invitation_accepted",
      title: "Kutsu hyväksytty",
      body: clubName,
      link: `/clubs/${invitation.clubId}`,
    });

    res.json({ success: true, message: "Invitation accepted" });
  }),
);

// POST /clubs/invitations/:invitationId/decline - Decline club invitation
router.post(
  "/invitations/:invitationId/decline",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { invitationId } = req.params;

    const [invitation] = await db
      .select()
      .from(clubInvitations)
      .where(
        and(
          eq(clubInvitations.id, invitationId),
          eq(clubInvitations.inviteeId, userId),
          eq(clubInvitations.status, "pending"),
        ),
      )
      .limit(1);

    if (!invitation) throw new AppError(404, "Invitation not found");

    await db
      .update(clubInvitations)
      .set({ status: "declined" })
      .where(eq(clubInvitations.id, invitationId));

    res.json({ success: true, message: "Invitation declined" });
  }),
);

// GET /clubs/:id - Get club details
router.get(
  "/:id",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    // Get club (by ID or slug)
    let [club] = await db.select().from(clubs).where(eq(clubs.id, id)).limit(1);

    if (!club) {
      // Try by slug
      const [clubBySlug] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.slug, id))
        .limit(1);

      if (!clubBySlug) {
        throw new AppError(404, "Club not found");
      }

      club = clubBySlug;
    }

    // Check membership
    let isMember = false;
    let memberRole = null;
    if (req.user) {
      const [membership] = await db
        .select()
        .from(clubMembers)
        .where(
          and(
            eq(clubMembers.clubId, club.id),
            eq(clubMembers.userId, req.user.id),
          ),
        )
        .limit(1);

      if (membership) {
        isMember = true;
        memberRole = membership.role;
      }
    }

    if (!club.isPublic && !isMember && req.user?.role !== "admin") {
      throw new AppError(403, "This club is private");
    }

    // Get moderators and admins
    const staffMembers = await db
      .select({
        user: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
        role: clubMembers.role,
      })
      .from(clubMembers)
      .leftJoin(users, eq(clubMembers.userId, users.id))
      .where(
        and(
          eq(clubMembers.clubId, club.id),
          or(eq(clubMembers.role, "moderator"), eq(clubMembers.role, "admin")),
        ),
      );

    // Get all members for member list
    const allMembers = await db
      .select({
        user: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
        role: clubMembers.role,
      })
      .from(clubMembers)
      .leftJoin(users, eq(clubMembers.userId, users.id))
      .where(eq(clubMembers.clubId, club.id));

    // Get threads
    const threadList = await db
      .select({
        thread: clubThreads,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
          identityVerified: users.identityVerified,
        },
      })
      .from(clubThreads)
      .leftJoin(users, eq(clubThreads.authorId, users.id))
      .where(
        and(eq(clubThreads.clubId, club.id), eq(clubThreads.isHidden, false)),
      )
      .orderBy(desc(clubThreads.isPinned), desc(clubThreads.updatedAt))
      .limit(50);

    // Get user's votes on threads
    const threadVoteMap = new Map<string, number>();
    if (req.user && threadList.length > 0) {
      const threadIds = threadList.map((t) => t.thread.id);
      const votes = await db
        .select({
          threadId: clubThreadVotes.threadId,
          value: clubThreadVotes.value,
        })
        .from(clubThreadVotes)
        .where(
          and(
            inArray(clubThreadVotes.threadId, threadIds),
            eq(clubThreadVotes.userId, req.user.id),
          ),
        );
      for (const v of votes) {
        threadVoteMap.set(v.threadId, v.value);
      }
    }

    res.json({
      success: true,
      data: {
        ...club,
        moderators: staffMembers.map((m) => m.user),
        members: allMembers.map((m) => ({
          ...m.user,
          role: m.role,
        })),
        threads: threadList.map(({ thread, author }) => ({
          ...thread,
          authorId: author?.id,
          userVote: threadVoteMap.get(thread.id) || 0,
          author,
        })),
        isMember,
        memberRole,
      },
    });
  }),
);

// POST /clubs - Create club
router.post(
  "/",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const data = createClubSchema.parse(req.body);

    // Check slug uniqueness
    const [existing] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.slug, data.slug))
      .limit(1);

    if (existing) {
      throw new AppError(400, "Club slug already exists");
    }

    // Create club
    const [newClub] = await db
      .insert(clubs)
      .values({
        name: data.name,
        slug: data.slug,
        description: data.description,
        rules: data.rules,
        category: data.category,
        coverImageUrl: data.coverImageUrl,
        isPublic: data.isPublic,
        latitude: data.latitude?.toString(),
        longitude: data.longitude?.toString(),
        address: data.address,
        municipalityId: data.municipalityId,
        creatorId: userId,
      })
      .returning();

    // Add creator as admin
    await db.insert(clubMembers).values({
      clubId: newClub.id,
      userId,
      role: "admin",
    });

    // Index in search
    indexClub({
      id: newClub.id,
      name: newClub.name,
      slug: newClub.slug,
      description: newClub.description ?? undefined,
      category: newClub.category ?? undefined,
      memberCount: 1,
      isPublic: newClub.isPublic ?? true,
      createdAt: newClub.createdAt?.toISOString() ?? new Date().toISOString(),
    }).catch(() => {});

    res.status(201).json({
      success: true,
      data: newClub,
    });
  }),
);

// PATCH /clubs/:id - Update club (admin/moderator only)
router.patch(
  "/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { id: clubId } = req.params;

    // Verify club exists
    const [club] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.id, clubId))
      .limit(1);

    if (!club) {
      throw new AppError(404, "Club not found");
    }

    // Check admin/moderator role
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)),
      )
      .limit(1);

    if (
      !membership ||
      (membership.role !== "admin" && membership.role !== "moderator")
    ) {
      throw new AppError(
        403,
        "Only admins and moderators can edit club settings",
      );
    }

    const data = updateClubSchema.parse(req.body);

    // Build update object
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.rules !== undefined) updateData.rules = data.rules;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.coverImageUrl !== undefined)
      updateData.coverImageUrl = data.coverImageUrl;
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;
    if (data.latitude !== undefined)
      updateData.latitude = data.latitude?.toString() ?? null;
    if (data.longitude !== undefined)
      updateData.longitude = data.longitude?.toString() ?? null;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.municipalityId !== undefined)
      updateData.municipalityId = data.municipalityId;

    const [updatedClub] = await db
      .update(clubs)
      .set(updateData)
      .where(eq(clubs.id, clubId))
      .returning();

    // Update search index
    indexClub({
      id: updatedClub.id,
      name: updatedClub.name,
      slug: updatedClub.slug,
      description: updatedClub.description ?? undefined,
      category: updatedClub.category ?? undefined,
      memberCount: updatedClub.memberCount ?? 0,
      isPublic: updatedClub.isPublic ?? true,
      createdAt:
        updatedClub.createdAt?.toISOString() ?? new Date().toISOString(),
    }).catch(() => {});

    res.json({
      success: true,
      data: updatedClub,
    });
  }),
);

// POST /clubs/:id/join - Join club
router.post(
  "/:id/join",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { id: clubId } = req.params;

    // Verify club exists
    const [club] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.id, clubId))
      .limit(1);

    if (!club) {
      throw new AppError(404, "Club not found");
    }

    // Private clubs cannot be joined directly — require invitation
    if (!club.isPublic && req.user!.role !== "admin") {
      throw new AppError(403, "This club is private — join by invitation only");
    }

    // Check if already member
    const [existing] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)),
      )
      .limit(1);

    if (existing) {
      throw new AppError(400, "Already a member");
    }

    // Join
    await db.insert(clubMembers).values({
      clubId,
      userId,
      role: "member",
    });

    // Update member count
    await db
      .update(clubs)
      .set({ memberCount: sql`${clubs.memberCount} + 1` })
      .where(eq(clubs.id, clubId));

    res.json({ success: true, message: "Joined club" });
  }),
);

// POST /clubs/:id/leave - Leave club
router.post(
  "/:id/leave",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { id: clubId } = req.params;

    // Check membership
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)),
      )
      .limit(1);

    if (!membership) {
      throw new AppError(400, "Not a member");
    }

    // Can't leave if only admin
    if (membership.role === "admin") {
      const [otherAdmin] = await db
        .select()
        .from(clubMembers)
        .where(
          and(eq(clubMembers.clubId, clubId), eq(clubMembers.role, "admin")),
        )
        .limit(2);

      // This check is simplified - in real app, check count
      if (!otherAdmin) {
        throw new AppError(400, "Cannot leave as the only admin");
      }
    }

    // Leave
    await db
      .delete(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)),
      );

    // Update member count
    await db
      .update(clubs)
      .set({ memberCount: sql`${clubs.memberCount} - 1` })
      .where(eq(clubs.id, clubId));

    res.json({ success: true, message: "Left club" });
  }),
);

// ─── Club Invitations ───

const clubInviteSchema = z.object({
  userId: z.string().uuid(),
});

// POST /clubs/:id/invite - Invite user to club (admin/moderator only)
router.post(
  "/:id/invite",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = req.user!.id;
    const { id: clubId } = req.params;
    const { userId: inviteeId } = clubInviteSchema.parse(req.body);

    // Verify club exists
    const [club] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.id, clubId))
      .limit(1);
    if (!club) throw new AppError(404, "Club not found");

    // Verify actor is admin or moderator
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, actorId)),
      )
      .limit(1);

    if (
      !membership ||
      (membership.role !== "admin" && membership.role !== "moderator")
    ) {
      throw new AppError(403, "Only admins and moderators can invite users");
    }

    // Verify invitee exists
    const [invitee] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, inviteeId))
      .limit(1);
    if (!invitee) throw new AppError(404, "User not found");

    // Check if invitee is already a member
    const [existingMember] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, inviteeId)),
      )
      .limit(1);
    if (existingMember) throw new AppError(400, "User is already a member");

    // Check for pending invitation
    const [existingInvite] = await db
      .select()
      .from(clubInvitations)
      .where(
        and(
          eq(clubInvitations.clubId, clubId),
          eq(clubInvitations.inviteeId, inviteeId),
          eq(clubInvitations.status, "pending"),
        ),
      )
      .limit(1);
    if (existingInvite)
      throw new AppError(400, "User already has a pending invitation");

    // Create invitation
    const [invitation] = await db
      .insert(clubInvitations)
      .values({ clubId, inviterId: actorId, inviteeId })
      .returning();

    // Notify invitee
    const [inviter] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    await notify({
      userId: inviteeId,
      type: "club_invitation",
      title: inviter?.name || "Kutsu klubiin",
      body: club.name,
      link: `/clubs`,
    });

    res.json({ success: true, data: invitation });
  }),
);

// GET /clubs/:id/invitations - List pending invitations for a club (admin/mod only)
router.get(
  "/:id/invitations",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = req.user!.id;
    const { id: clubId } = req.params;

    // Verify admin/mod
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, actorId)),
      )
      .limit(1);

    if (
      !membership ||
      (membership.role !== "admin" && membership.role !== "moderator")
    ) {
      throw new AppError(
        403,
        "Only admins and moderators can view invitations",
      );
    }

    const invitations = await db
      .select({
        id: clubInvitations.id,
        status: clubInvitations.status,
        createdAt: clubInvitations.createdAt,
        invitee: {
          id: users.id,
          name: users.name,
          username: users.username,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(clubInvitations)
      .innerJoin(users, eq(clubInvitations.inviteeId, users.id))
      .where(
        and(
          eq(clubInvitations.clubId, clubId),
          eq(clubInvitations.status, "pending"),
        ),
      )
      .orderBy(desc(clubInvitations.createdAt));

    res.json({ success: true, data: invitations });
  }),
);

// DELETE /clubs/:id/invitations/:invitationId - Cancel/revoke invitation (admin/mod only)
router.delete(
  "/:id/invitations/:invitationId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = req.user!.id;
    const { id: clubId, invitationId } = req.params;

    // Verify admin/mod
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, actorId)),
      )
      .limit(1);

    if (
      !membership ||
      (membership.role !== "admin" && membership.role !== "moderator")
    ) {
      throw new AppError(
        403,
        "Only admins and moderators can cancel invitations",
      );
    }

    await db
      .delete(clubInvitations)
      .where(
        and(
          eq(clubInvitations.id, invitationId),
          eq(clubInvitations.clubId, clubId),
          eq(clubInvitations.status, "pending"),
        ),
      );

    res.json({ success: true, message: "Invitation cancelled" });
  }),
);

// POST /clubs/:id/threads - Create thread in club
router.post(
  "/:id/threads",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { id: clubId } = req.params;
    const data = createClubThreadSchema.parse(req.body);

    // Verify membership
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)),
      )
      .limit(1);

    if (!membership) {
      throw new AppError(403, "Must be a member to post");
    }

    // Render markdown
    const contentHtml = renderMarkdown(data.content);

    // Create thread
    const [newThread] = await db
      .insert(clubThreads)
      .values({
        clubId,
        authorId: userId,
        title: data.title,
        content: data.content,
        contentHtml,
        language: data.language || req.user?.locale || "fi",
      })
      .returning();

    res.status(201).json({
      success: true,
      data: newThread,
    });
  }),
);

// GET /clubs/:clubId/threads/:threadId - Get club thread
router.get(
  "/:clubId/threads/:threadId",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { clubId, threadId } = req.params;

    const [club] = await db
      .select({ id: clubs.id, isPublic: clubs.isPublic })
      .from(clubs)
      .where(eq(clubs.id, clubId))
      .limit(1);

    if (!club) {
      throw new AppError(404, "Club not found");
    }

    let memberRole = null;
    if (req.user) {
      const [membership] = await db
        .select()
        .from(clubMembers)
        .where(
          and(
            eq(clubMembers.clubId, club.id),
            eq(clubMembers.userId, req.user.id),
          ),
        )
        .limit(1);

      if (membership) {
        memberRole = membership.role;
      }
    }

    if (!club.isPublic && !memberRole && req.user?.role !== "admin") {
      throw new AppError(403, "This club is private");
    }

    const [threadData] = await db
      .select({
        thread: clubThreads,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
          role: users.role,
          identityVerified: users.identityVerified,
        },
      })
      .from(clubThreads)
      .leftJoin(users, eq(clubThreads.authorId, users.id))
      .where(and(eq(clubThreads.id, threadId), eq(clubThreads.clubId, clubId)))
      .limit(1);

    if (!threadData) {
      throw new AppError(404, "Thread not found");
    }

    // Get user's vote on thread
    let threadUserVote = 0;
    if (req.user) {
      const [tv] = await db
        .select({ value: clubThreadVotes.value })
        .from(clubThreadVotes)
        .where(
          and(
            eq(clubThreadVotes.threadId, threadId),
            eq(clubThreadVotes.userId, req.user.id),
          ),
        )
        .limit(1);
      threadUserVote = tv?.value || 0;
    }

    // Get comments
    const commentList = await db
      .select({
        comment: clubComments,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
          role: users.role,
          identityVerified: users.identityVerified,
        },
      })
      .from(clubComments)
      .leftJoin(users, eq(clubComments.authorId, users.id))
      .where(eq(clubComments.threadId, threadId))
      .orderBy(clubComments.createdAt);

    // Get user's votes on comments
    const commentVoteMap = new Map<string, number>();
    if (req.user && commentList.length > 0) {
      const commentIds = commentList.map((c) => c.comment.id);
      const votes = await db
        .select({
          commentId: clubCommentVotes.commentId,
          value: clubCommentVotes.value,
        })
        .from(clubCommentVotes)
        .where(
          and(
            inArray(clubCommentVotes.commentId, commentIds),
            eq(clubCommentVotes.userId, req.user.id),
          ),
        );
      for (const v of votes) {
        commentVoteMap.set(v.commentId, v.value);
      }
    }

    res.json({
      success: true,
      data: {
        ...threadData.thread,
        authorId: threadData.author?.id,
        userVote: threadUserVote,
        author: threadData.author,
        memberRole,
        comments: commentList.map(({ comment, author }) => {
          if (comment.isHidden) {
            return {
              id: comment.id,
              threadId: comment.threadId,
              parentId: comment.parentId,
              authorId: author?.id,
              content: "",
              contentHtml: null,
              score: 0,
              userVote: 0,
              createdAt: comment.createdAt,
              isHidden: true,
              author: null,
            };
          }
          return {
            ...comment,
            authorId: author?.id,
            userVote: commentVoteMap.get(comment.id) || 0,
            author,
          };
        }),
      },
    });
  }),
);

// POST /clubs/:clubId/threads/:threadId/comments - Add comment
router.post(
  "/:clubId/threads/:threadId/comments",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { clubId, threadId } = req.params;
    const data = createClubCommentSchema.parse(req.body);

    // Verify membership
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)),
      )
      .limit(1);

    if (!membership) {
      throw new AppError(403, "Must be a member to comment");
    }

    // Verify thread exists
    const [thread] = await db
      .select()
      .from(clubThreads)
      .where(and(eq(clubThreads.id, threadId), eq(clubThreads.clubId, clubId)))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    if (thread.isLocked) {
      throw new AppError(403, "Thread is locked");
    }

    // Render markdown
    const contentHtml = renderMarkdown(data.content);

    // Create comment
    const [newComment] = await db
      .insert(clubComments)
      .values({
        threadId,
        authorId: userId,
        parentId: data.parentId,
        content: data.content,
        contentHtml,
        language: data.language || req.user?.locale || "fi",
      })
      .returning();

    // Update reply count
    await db
      .update(clubThreads)
      .set({
        replyCount: sql`${clubThreads.replyCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(clubThreads.id, threadId));

    // Notifications
    const commenterName = req.user!.name || "Someone";
    const truncatedContent =
      data.content.length > 100
        ? data.content.slice(0, 100) + "..."
        : data.content;
    const notifiedUserIds = new Set<string>();

    // 1. Notify parent comment author (reply to their comment)
    if (data.parentId) {
      const [parentComment] = await db
        .select({ authorId: clubComments.authorId })
        .from(clubComments)
        .where(eq(clubComments.id, data.parentId))
        .limit(1);

      if (parentComment && parentComment.authorId !== userId) {
        notifiedUserIds.add(parentComment.authorId);
        await notify({
          userId: parentComment.authorId,
          type: "reply",
          title: commenterName,
          body: truncatedContent,
          link: `/clubs/${clubId}/thread/${threadId}`,
        });
      }
    }

    // 2. Notify thread author (new comment on their thread)
    if (thread.authorId !== userId && !notifiedUserIds.has(thread.authorId)) {
      notifiedUserIds.add(thread.authorId);
      await notify({
        userId: thread.authorId,
        type: "thread_reply",
        title: commenterName,
        body: truncatedContent,
        link: `/clubs/${clubId}/thread/${threadId}`,
      });
    }

    res.status(201).json({
      success: true,
      data: newComment,
    });
  }),
);

// POST /clubs/:clubId/threads/:threadId/vote - Vote on a club thread
router.post(
  "/:clubId/threads/:threadId/vote",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { clubId, threadId } = req.params;
    const { value } = clubVoteSchema.parse(req.body);

    // Verify membership
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)),
      )
      .limit(1);

    if (!membership) {
      throw new AppError(403, "Must be a member to vote");
    }

    // Verify thread exists
    const [thread] = await db
      .select()
      .from(clubThreads)
      .where(and(eq(clubThreads.id, threadId), eq(clubThreads.clubId, clubId)))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    const [existingVote] = await db
      .select()
      .from(clubThreadVotes)
      .where(
        and(
          eq(clubThreadVotes.threadId, threadId),
          eq(clubThreadVotes.userId, userId),
        ),
      )
      .limit(1);

    const oldValue = existingVote?.value || 0;
    const scoreDelta = value - oldValue;

    if (value === 0) {
      if (existingVote) {
        await db
          .delete(clubThreadVotes)
          .where(
            and(
              eq(clubThreadVotes.threadId, threadId),
              eq(clubThreadVotes.userId, userId),
            ),
          );
      }
    } else if (existingVote) {
      await db
        .update(clubThreadVotes)
        .set({ value })
        .where(
          and(
            eq(clubThreadVotes.threadId, threadId),
            eq(clubThreadVotes.userId, userId),
          ),
        );
    } else {
      await db.insert(clubThreadVotes).values({ threadId, userId, value });
    }

    if (scoreDelta !== 0) {
      await db
        .update(clubThreads)
        .set({ score: sql`${clubThreads.score} + ${scoreDelta}` })
        .where(eq(clubThreads.id, threadId));
    }

    const [updated] = await db
      .select({ score: clubThreads.score })
      .from(clubThreads)
      .where(eq(clubThreads.id, threadId))
      .limit(1);

    res.json({
      success: true,
      data: { threadId, score: updated.score, userVote: value },
    });
  }),
);

// POST /clubs/:clubId/threads/:threadId/comments/:commentId/vote - Vote on a club comment
router.post(
  "/:clubId/threads/:threadId/comments/:commentId/vote",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { clubId, commentId } = req.params;

    const { value } = clubVoteSchema.parse(req.body);

    // Verify membership
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)),
      )
      .limit(1);

    if (!membership) {
      throw new AppError(403, "Must be a member to vote");
    }

    const [comment] = await db
      .select()
      .from(clubComments)
      .where(eq(clubComments.id, commentId))
      .limit(1);

    if (!comment) {
      throw new AppError(404, "Comment not found");
    }

    const [existingVote] = await db
      .select()
      .from(clubCommentVotes)
      .where(
        and(
          eq(clubCommentVotes.commentId, commentId),
          eq(clubCommentVotes.userId, userId),
        ),
      )
      .limit(1);

    const oldValue = existingVote?.value || 0;
    const scoreDelta = value - oldValue;

    if (value === 0) {
      if (existingVote) {
        await db
          .delete(clubCommentVotes)
          .where(
            and(
              eq(clubCommentVotes.commentId, commentId),
              eq(clubCommentVotes.userId, userId),
            ),
          );
      }
    } else if (existingVote) {
      await db
        .update(clubCommentVotes)
        .set({ value })
        .where(
          and(
            eq(clubCommentVotes.commentId, commentId),
            eq(clubCommentVotes.userId, userId),
          ),
        );
    } else {
      await db.insert(clubCommentVotes).values({ commentId, userId, value });
    }

    if (scoreDelta !== 0) {
      await db
        .update(clubComments)
        .set({ score: sql`${clubComments.score} + ${scoreDelta}` })
        .where(eq(clubComments.id, commentId));
    }

    const [updated] = await db
      .select({ score: clubComments.score })
      .from(clubComments)
      .where(eq(clubComments.id, commentId))
      .limit(1);

    res.json({
      success: true,
      data: { commentId, score: updated.score, userVote: value },
    });
  }),
);

// ── Moderation endpoints ──

const updateMemberRoleSchema = z.object({
  role: z.enum(["member", "moderator", "admin"]),
});

const updateThreadModerationSchema = z.object({
  isLocked: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

// PATCH /clubs/:id/members/:userId/role — Change member role
router.patch(
  "/:id/members/:userId/role",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = req.user!.id;
    const { id: clubId, userId: targetUserId } = req.params;
    const { role: newRole } = updateMemberRoleSchema.parse(req.body);

    // Check actor is admin
    const [actorMembership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, actorId)),
      )
      .limit(1);

    if (!actorMembership || actorMembership.role !== "admin") {
      throw new AppError(403, "Only admins can change member roles");
    }

    // Check target is a member
    const [targetMembership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(
          eq(clubMembers.clubId, clubId),
          eq(clubMembers.userId, targetUserId),
        ),
      )
      .limit(1);

    if (!targetMembership) {
      throw new AppError(404, "Member not found");
    }

    // Admin cannot demote themselves if they are the only admin
    if (
      actorId === targetUserId &&
      targetMembership.role === "admin" &&
      newRole !== "admin"
    ) {
      const adminCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(clubMembers)
        .where(
          and(eq(clubMembers.clubId, clubId), eq(clubMembers.role, "admin")),
        );

      if (adminCount[0].count <= 1) {
        throw new AppError(400, "Cannot demote the only admin");
      }
    }

    await db
      .update(clubMembers)
      .set({ role: newRole })
      .where(
        and(
          eq(clubMembers.clubId, clubId),
          eq(clubMembers.userId, targetUserId),
        ),
      );

    res.json({ success: true, message: "Role updated" });
  }),
);

// DELETE /clubs/:id/members/:userId — Remove member from club
router.delete(
  "/:id/members/:userId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = req.user!.id;
    const { id: clubId, userId: targetUserId } = req.params;

    if (actorId === targetUserId) {
      throw new AppError(400, "Cannot remove yourself — use leave instead");
    }

    // Check actor membership
    const [actorMembership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, actorId)),
      )
      .limit(1);

    if (
      !actorMembership ||
      (actorMembership.role !== "admin" && actorMembership.role !== "moderator")
    ) {
      throw new AppError(403, "Only admins and moderators can remove members");
    }

    // Check target membership
    const [targetMembership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(
          eq(clubMembers.clubId, clubId),
          eq(clubMembers.userId, targetUserId),
        ),
      )
      .limit(1);

    if (!targetMembership) {
      throw new AppError(404, "Member not found");
    }

    // Moderator cannot remove admin or other moderators
    if (
      actorMembership.role === "moderator" &&
      (targetMembership.role === "admin" ||
        targetMembership.role === "moderator")
    ) {
      throw new AppError(
        403,
        "Moderators cannot remove admins or other moderators",
      );
    }

    await db
      .delete(clubMembers)
      .where(
        and(
          eq(clubMembers.clubId, clubId),
          eq(clubMembers.userId, targetUserId),
        ),
      );

    // Update member count
    await db
      .update(clubs)
      .set({ memberCount: sql`${clubs.memberCount} - 1` })
      .where(eq(clubs.id, clubId));

    res.json({ success: true, message: "Member removed" });
  }),
);

// DELETE /clubs/:clubId/threads/:threadId — Delete thread
router.delete(
  "/:clubId/threads/:threadId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = req.user!.id;
    const { clubId, threadId } = req.params;

    // Get the thread
    const [thread] = await db
      .select()
      .from(clubThreads)
      .where(and(eq(clubThreads.id, threadId), eq(clubThreads.clubId, clubId)))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    // Check permissions: author, admin, or moderator
    const isAuthor = thread.authorId === actorId;
    if (!isAuthor) {
      const [membership] = await db
        .select()
        .from(clubMembers)
        .where(
          and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, actorId)),
        )
        .limit(1);

      if (
        !membership ||
        (membership.role !== "admin" && membership.role !== "moderator")
      ) {
        throw new AppError(403, "Not authorized to delete this thread");
      }
    }

    // Delete thread (comments cascade via DB)
    await db.delete(clubThreads).where(eq(clubThreads.id, threadId));

    res.json({ success: true, message: "Thread deleted" });
  }),
);

// PATCH /clubs/:clubId/threads/:threadId — Lock/pin thread
router.patch(
  "/:clubId/threads/:threadId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = req.user!.id;
    const { clubId, threadId } = req.params;
    const data = updateThreadModerationSchema.parse(req.body);

    // Check actor is admin or moderator
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, actorId)),
      )
      .limit(1);

    if (
      !membership ||
      (membership.role !== "admin" && membership.role !== "moderator")
    ) {
      throw new AppError(
        403,
        "Only admins and moderators can lock/pin threads",
      );
    }

    // Verify thread exists in this club
    const [thread] = await db
      .select()
      .from(clubThreads)
      .where(and(eq(clubThreads.id, threadId), eq(clubThreads.clubId, clubId)))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.isLocked !== undefined) updateData.isLocked = data.isLocked;
    if (data.isPinned !== undefined) updateData.isPinned = data.isPinned;

    const [updatedThread] = await db
      .update(clubThreads)
      .set(updateData)
      .where(eq(clubThreads.id, threadId))
      .returning();

    res.json({ success: true, data: updatedThread });
  }),
);

// DELETE /clubs/:clubId/threads/:threadId/comments/:commentId — Delete comment
router.delete(
  "/:clubId/threads/:threadId/comments/:commentId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = req.user!.id;
    const { clubId, threadId, commentId } = req.params;

    // Verify thread exists in this club
    const [thread] = await db
      .select()
      .from(clubThreads)
      .where(and(eq(clubThreads.id, threadId), eq(clubThreads.clubId, clubId)))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    // Get the comment
    const [comment] = await db
      .select()
      .from(clubComments)
      .where(
        and(
          eq(clubComments.id, commentId),
          eq(clubComments.threadId, threadId),
        ),
      )
      .limit(1);

    if (!comment) {
      throw new AppError(404, "Comment not found");
    }

    // Check permissions: author, admin, or moderator
    const isAuthor = comment.authorId === actorId;
    if (!isAuthor) {
      const [membership] = await db
        .select()
        .from(clubMembers)
        .where(
          and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, actorId)),
        )
        .limit(1);

      if (
        !membership ||
        (membership.role !== "admin" && membership.role !== "moderator")
      ) {
        throw new AppError(403, "Not authorized to delete this comment");
      }
    }

    await db.delete(clubComments).where(eq(clubComments.id, commentId));

    // Update reply count
    await db
      .update(clubThreads)
      .set({
        replyCount: sql`GREATEST(${clubThreads.replyCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(clubThreads.id, threadId));

    res.json({ success: true, message: "Comment deleted" });
  }),
);

// DELETE /clubs/:id - Delete club (admin only)
router.delete(
  "/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const actorId = req.user!.id;

    // Check membership — must be club admin
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(and(eq(clubMembers.clubId, id), eq(clubMembers.userId, actorId)))
      .limit(1);

    if (!membership || membership.role !== "admin") {
      throw new AppError(403, "Only club admins can delete a club");
    }

    // Delete club (cascade removes members, threads, comments, votes)
    await db.delete(clubs).where(eq(clubs.id, id));

    res.json({ success: true, message: "Club deleted" });
  }),
);

// GET /clubs/categories - Get club categories
router.get(
  "/meta/categories",
  asyncHandler(async (_req, res: Response) => {
    const categories = await db
      .select({ category: clubs.category, count: sql<number>`count(*)::int` })
      .from(clubs)
      .where(eq(clubs.isPublic, true))
      .groupBy(clubs.category)
      .orderBy(desc(sql`count(*)`));

    res.json({
      success: true,
      data: categories.filter((c) => c.category),
    });
  }),
);

export default router;
