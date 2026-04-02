import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  rooms,
  roomMembers,
  roomThreads,
  roomComments,
  roomThreadVotes,
  roomCommentVotes,
  roomInvitations,
  users,
  threads,
  clubMembers,
  clubs,
} from "../db/index.js";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { renderMarkdown } from "../utils/markdown.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { notify } from "../services/notify.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();

// Validation schemas
const createRoomSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  visibility: z.enum(["public", "private"]).default("public"),
});

const updateRoomSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  isPinned: z.boolean().optional(),
});

const createThreadSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(10000),
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  parentId: z.string().uuid().optional(),
});

const voteSchema = z.object({
  value: z.number().int().min(-1).max(1),
});

const updateThreadModerationSchema = z.object({
  isLocked: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

const inviteSchema = z.object({
  userId: z.string().uuid(),
});

// ============================================================
// INVITATIONS — must be before /:userId catch-all
// ============================================================

// GET /home/invitations - Get user's pending invitations
router.get(
  "/invitations",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;

    const invitations = await db
      .select({
        invitation: roomInvitations,
        room: rooms,
        inviter: users,
      })
      .from(roomInvitations)
      .innerJoin(rooms, eq(roomInvitations.roomId, rooms.id))
      .innerJoin(users, eq(roomInvitations.inviterId, users.id))
      .where(
        and(
          eq(roomInvitations.inviteeId, userId),
          eq(roomInvitations.status, "pending"),
        ),
      )
      .orderBy(desc(roomInvitations.createdAt));

    res.json({
      success: true,
      data: invitations.map(({ invitation, room, inviter }) => ({
        ...invitation,
        room: {
          id: room.id,
          name: room.name,
          description: room.description,
        },
        inviter,
      })),
    });
  }),
);

// POST /home/invitations/:invitationId/accept - Accept invitation
router.post(
  "/invitations/:invitationId/accept",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { invitationId } = req.params;

    const [invitation] = await db
      .select()
      .from(roomInvitations)
      .where(eq(roomInvitations.id, invitationId))
      .limit(1);

    if (!invitation) {
      throw new AppError(404, "Invitation not found");
    }

    if (invitation.inviteeId !== userId) {
      throw new AppError(403, "This invitation is not for you");
    }

    if (invitation.status !== "pending") {
      throw new AppError(400, "Invitation already processed");
    }

    // Update invitation status
    await db
      .update(roomInvitations)
      .set({ status: "accepted" })
      .where(eq(roomInvitations.id, invitationId));

    // Add as member
    await db.insert(roomMembers).values({
      roomId: invitation.roomId,
      userId,
    });

    res.json({
      success: true,
      data: { accepted: true },
    });
  }),
);

// POST /home/invitations/:invitationId/decline - Decline invitation
router.post(
  "/invitations/:invitationId/decline",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { invitationId } = req.params;

    const [invitation] = await db
      .select()
      .from(roomInvitations)
      .where(eq(roomInvitations.id, invitationId))
      .limit(1);

    if (!invitation) {
      throw new AppError(404, "Invitation not found");
    }

    if (invitation.inviteeId !== userId) {
      throw new AppError(403, "This invitation is not for you");
    }

    if (invitation.status !== "pending") {
      throw new AppError(400, "Invitation already processed");
    }

    await db
      .update(roomInvitations)
      .set({ status: "declined" })
      .where(eq(roomInvitations.id, invitationId));

    res.json({
      success: true,
      data: { declined: true },
    });
  }),
);

// ============================================================
// ROOMS — /rooms/* routes before /:userId catch-all
// ============================================================

// POST /home/rooms - Create a new room
router.post(
  "/rooms",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const data = createRoomSchema.parse(req.body);

    const [room] = await db
      .insert(rooms)
      .values({
        ownerId: userId,
        name: data.name,
        description: data.description,
        visibility: data.visibility,
      })
      .returning();

    res.status(201).json({
      success: true,
      data: room,
    });
  }),
);

// GET /home/rooms/:roomId - Get room with threads
router.get(
  "/rooms/:roomId",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { roomId } = req.params;
    const currentUserId = req.user?.id;

    // Get room with owner
    const [roomData] = await db
      .select({
        room: rooms,
        owner: users,
      })
      .from(rooms)
      .innerJoin(users, eq(rooms.ownerId, users.id))
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!roomData) {
      throw new AppError(404, "Room not found");
    }

    const { room, owner } = roomData;
    const isOwner = currentUserId === owner.id;

    // Check access for private rooms
    if (room.visibility === "private" && !isOwner) {
      if (!currentUserId) {
        throw new AppError(401, "Authentication required");
      }

      const [membership] = await db
        .select()
        .from(roomMembers)
        .where(
          and(
            eq(roomMembers.roomId, roomId),
            eq(roomMembers.userId, currentUserId),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new AppError(403, "Not a member of this room");
      }
    }

    // Get threads
    const threadList = await db
      .select({
        thread: roomThreads,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
          identityVerified: users.identityVerified,
        },
      })
      .from(roomThreads)
      .leftJoin(users, eq(roomThreads.authorId, users.id))
      .where(
        and(eq(roomThreads.roomId, roomId), eq(roomThreads.isHidden, false)),
      )
      .orderBy(desc(roomThreads.isPinned), desc(roomThreads.updatedAt))
      .limit(50);

    // Get user's votes on threads
    const threadVoteMap = new Map<string, number>();
    if (currentUserId && threadList.length > 0) {
      const threadIds = threadList.map((t) => t.thread.id);
      const votes = await db
        .select({
          threadId: roomThreadVotes.threadId,
          value: roomThreadVotes.value,
        })
        .from(roomThreadVotes)
        .where(
          and(
            inArray(roomThreadVotes.threadId, threadIds),
            eq(roomThreadVotes.userId, currentUserId),
          ),
        );
      for (const v of votes) {
        threadVoteMap.set(v.threadId, v.value);
      }
    }

    // Get members (for private rooms)
    let members: (typeof users.$inferSelect)[] = [];
    if (room.visibility === "private") {
      const membersData = await db
        .select({ user: users })
        .from(roomMembers)
        .innerJoin(users, eq(roomMembers.userId, users.id))
        .where(eq(roomMembers.roomId, roomId));

      members = membersData.map((m) => m.user);
    }

    res.json({
      success: true,
      data: {
        ...room,
        owner,
        members,
        threads: threadList.map(({ thread, author }) => ({
          ...thread,
          userVote: threadVoteMap.get(thread.id) || 0,
          author,
        })),
        isOwner,
        canPost:
          room.visibility === "public" ||
          isOwner ||
          members.some((m) => m.id === currentUserId),
      },
    });
  }),
);

// PATCH /home/rooms/:roomId - Update room
router.patch(
  "/rooms/:roomId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const data = updateRoomSchema.parse(req.body);

    // Verify ownership
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    if (room.ownerId !== userId) {
      throw new AppError(403, "Only the owner can update this room");
    }

    const [updatedRoom] = await db
      .update(rooms)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(rooms.id, roomId))
      .returning();

    res.json({
      success: true,
      data: updatedRoom,
    });
  }),
);

// DELETE /home/rooms/:roomId - Delete room
router.delete(
  "/rooms/:roomId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId } = req.params;

    // Verify ownership
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    if (room.ownerId !== userId) {
      throw new AppError(403, "Only the owner can delete this room");
    }

    await db.delete(rooms).where(eq(rooms.id, roomId));

    res.json({
      success: true,
      data: { deleted: true },
    });
  }),
);

// Helper to check room access and return room
async function verifyRoomAccess(
  roomId: string,
  userId: string | undefined,
  requirePost = false,
) {
  const [roomData] = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1);

  if (!roomData) {
    throw new AppError(404, "Room not found");
  }

  const isOwner = userId === roomData.ownerId;

  if (roomData.visibility === "private" && !isOwner) {
    if (!userId) throw new AppError(401, "Authentication required");

    const [membership] = await db
      .select()
      .from(roomMembers)
      .where(
        and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)),
      )
      .limit(1);

    if (!membership) {
      throw new AppError(403, "Not a member of this room");
    }
  }

  if (requirePost && !userId) {
    throw new AppError(401, "Authentication required");
  }

  return { room: roomData, isOwner };
}

// POST /home/rooms/:roomId/threads - Create thread in room
router.post(
  "/rooms/:roomId/threads",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const data = createThreadSchema.parse(req.body);

    await verifyRoomAccess(roomId, userId, true);

    const contentHtml = renderMarkdown(data.content);

    const [newThread] = await db
      .insert(roomThreads)
      .values({
        roomId,
        authorId: userId,
        title: data.title,
        content: data.content,
        contentHtml,
      })
      .returning();

    // Update thread count
    await db
      .update(rooms)
      .set({
        updatedAt: new Date(),
        threadCount: sql`${rooms.threadCount} + 1`,
      })
      .where(eq(rooms.id, roomId));

    res.status(201).json({
      success: true,
      data: newThread,
    });
  }),
);

// GET /home/rooms/:roomId/threads/:threadId - Get thread with comments
router.get(
  "/rooms/:roomId/threads/:threadId",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { roomId, threadId } = req.params;
    const currentUserId = req.user?.id;

    await verifyRoomAccess(roomId, currentUserId);

    const [threadData] = await db
      .select({
        thread: roomThreads,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
          role: users.role,
          identityVerified: users.identityVerified,
        },
      })
      .from(roomThreads)
      .leftJoin(users, eq(roomThreads.authorId, users.id))
      .where(and(eq(roomThreads.id, threadId), eq(roomThreads.roomId, roomId)))
      .limit(1);

    if (!threadData) {
      throw new AppError(404, "Thread not found");
    }

    // Get user's vote on thread
    let threadUserVote = 0;
    if (currentUserId) {
      const [tv] = await db
        .select({ value: roomThreadVotes.value })
        .from(roomThreadVotes)
        .where(
          and(
            eq(roomThreadVotes.threadId, threadId),
            eq(roomThreadVotes.userId, currentUserId),
          ),
        )
        .limit(1);
      threadUserVote = tv?.value || 0;
    }

    // Get comments
    const commentList = await db
      .select({
        comment: roomComments,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
          role: users.role,
          identityVerified: users.identityVerified,
        },
      })
      .from(roomComments)
      .leftJoin(users, eq(roomComments.authorId, users.id))
      .where(eq(roomComments.threadId, threadId))
      .orderBy(roomComments.createdAt);

    // Get user's votes on comments
    const commentVoteMap = new Map<string, number>();
    if (currentUserId && commentList.length > 0) {
      const commentIds = commentList.map((c) => c.comment.id);
      const votes = await db
        .select({
          commentId: roomCommentVotes.commentId,
          value: roomCommentVotes.value,
        })
        .from(roomCommentVotes)
        .where(
          and(
            inArray(roomCommentVotes.commentId, commentIds),
            eq(roomCommentVotes.userId, currentUserId),
          ),
        );
      for (const v of votes) {
        commentVoteMap.set(v.commentId, v.value);
      }
    }

    // Check if user is room owner
    const [room] = await db
      .select({ ownerId: rooms.ownerId })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    res.json({
      success: true,
      data: {
        ...threadData.thread,
        userVote: threadUserVote,
        author: threadData.author,
        isRoomOwner: currentUserId === room?.ownerId,
        comments: commentList.map(({ comment, author }) => {
          if (comment.isHidden) {
            return {
              id: comment.id,
              threadId: comment.threadId,
              parentId: comment.parentId,
              authorId: comment.authorId,
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
            userVote: commentVoteMap.get(comment.id) || 0,
            author,
          };
        }),
      },
    });
  }),
);

// POST /home/rooms/:roomId/threads/:threadId/comments - Add comment
router.post(
  "/rooms/:roomId/threads/:threadId/comments",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, threadId } = req.params;
    const data = createCommentSchema.parse(req.body);

    await verifyRoomAccess(roomId, userId, true);

    // Verify thread exists and is not locked
    const [thread] = await db
      .select()
      .from(roomThreads)
      .where(and(eq(roomThreads.id, threadId), eq(roomThreads.roomId, roomId)))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    if (thread.isLocked) {
      throw new AppError(403, "Thread is locked");
    }

    const contentHtml = renderMarkdown(data.content);

    const [newComment] = await db
      .insert(roomComments)
      .values({
        threadId,
        authorId: userId,
        parentId: data.parentId,
        content: data.content,
        contentHtml,
      })
      .returning();

    // Update reply count
    await db
      .update(roomThreads)
      .set({
        replyCount: sql`${roomThreads.replyCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(roomThreads.id, threadId));

    // Notifications
    const commenterName = req.user!.name || "Someone";
    const truncatedContent =
      data.content.length > 100
        ? data.content.slice(0, 100) + "..."
        : data.content;
    const notifiedUserIds = new Set<string>();

    // Notify parent comment author
    if (data.parentId) {
      const [parentComment] = await db
        .select({ authorId: roomComments.authorId })
        .from(roomComments)
        .where(eq(roomComments.id, data.parentId))
        .limit(1);

      if (parentComment && parentComment.authorId !== userId) {
        notifiedUserIds.add(parentComment.authorId);
        await notify({
          userId: parentComment.authorId,
          type: "reply",
          title: commenterName,
          body: truncatedContent,
          link: `/home/room/${roomId}/thread/${threadId}`,
        });
      }
    }

    // Notify thread author
    if (thread.authorId !== userId && !notifiedUserIds.has(thread.authorId)) {
      await notify({
        userId: thread.authorId,
        type: "thread_reply",
        title: commenterName,
        body: truncatedContent,
        link: `/home/room/${roomId}/thread/${threadId}`,
      });
    }

    res.status(201).json({
      success: true,
      data: newComment,
    });
  }),
);

// POST /home/rooms/:roomId/threads/:threadId/vote - Vote on thread
router.post(
  "/rooms/:roomId/threads/:threadId/vote",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, threadId } = req.params;
    const { value } = voteSchema.parse(req.body);

    await verifyRoomAccess(roomId, userId);

    const [thread] = await db
      .select()
      .from(roomThreads)
      .where(and(eq(roomThreads.id, threadId), eq(roomThreads.roomId, roomId)))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    const [existingVote] = await db
      .select()
      .from(roomThreadVotes)
      .where(
        and(
          eq(roomThreadVotes.threadId, threadId),
          eq(roomThreadVotes.userId, userId),
        ),
      )
      .limit(1);

    const oldValue = existingVote?.value || 0;
    const scoreDelta = value - oldValue;

    if (value === 0) {
      if (existingVote) {
        await db
          .delete(roomThreadVotes)
          .where(
            and(
              eq(roomThreadVotes.threadId, threadId),
              eq(roomThreadVotes.userId, userId),
            ),
          );
      }
    } else if (existingVote) {
      await db
        .update(roomThreadVotes)
        .set({ value })
        .where(
          and(
            eq(roomThreadVotes.threadId, threadId),
            eq(roomThreadVotes.userId, userId),
          ),
        );
    } else {
      await db.insert(roomThreadVotes).values({ threadId, userId, value });
    }

    if (scoreDelta !== 0) {
      await db
        .update(roomThreads)
        .set({ score: sql`${roomThreads.score} + ${scoreDelta}` })
        .where(eq(roomThreads.id, threadId));
    }

    const [updated] = await db
      .select({ score: roomThreads.score })
      .from(roomThreads)
      .where(eq(roomThreads.id, threadId))
      .limit(1);

    res.json({
      success: true,
      data: { threadId, score: updated.score, userVote: value },
    });
  }),
);

// POST /home/rooms/:roomId/threads/:threadId/comments/:commentId/vote - Vote on comment
router.post(
  "/rooms/:roomId/threads/:threadId/comments/:commentId/vote",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, commentId } = req.params;
    const { value } = voteSchema.parse(req.body);

    await verifyRoomAccess(roomId, userId);

    const [comment] = await db
      .select()
      .from(roomComments)
      .where(eq(roomComments.id, commentId))
      .limit(1);

    if (!comment) {
      throw new AppError(404, "Comment not found");
    }

    const [existingVote] = await db
      .select()
      .from(roomCommentVotes)
      .where(
        and(
          eq(roomCommentVotes.commentId, commentId),
          eq(roomCommentVotes.userId, userId),
        ),
      )
      .limit(1);

    const oldValue = existingVote?.value || 0;
    const scoreDelta = value - oldValue;

    if (value === 0) {
      if (existingVote) {
        await db
          .delete(roomCommentVotes)
          .where(
            and(
              eq(roomCommentVotes.commentId, commentId),
              eq(roomCommentVotes.userId, userId),
            ),
          );
      }
    } else if (existingVote) {
      await db
        .update(roomCommentVotes)
        .set({ value })
        .where(
          and(
            eq(roomCommentVotes.commentId, commentId),
            eq(roomCommentVotes.userId, userId),
          ),
        );
    } else {
      await db.insert(roomCommentVotes).values({ commentId, userId, value });
    }

    if (scoreDelta !== 0) {
      await db
        .update(roomComments)
        .set({ score: sql`${roomComments.score} + ${scoreDelta}` })
        .where(eq(roomComments.id, commentId));
    }

    const [updated] = await db
      .select({ score: roomComments.score })
      .from(roomComments)
      .where(eq(roomComments.id, commentId))
      .limit(1);

    res.json({
      success: true,
      data: { commentId, score: updated.score, userVote: value },
    });
  }),
);

// DELETE /home/rooms/:roomId/threads/:threadId - Delete thread
router.delete(
  "/rooms/:roomId/threads/:threadId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, threadId } = req.params;

    const [thread] = await db
      .select()
      .from(roomThreads)
      .where(and(eq(roomThreads.id, threadId), eq(roomThreads.roomId, roomId)))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    // Check permissions: author, room owner, or admin
    const isAuthor = thread.authorId === userId;
    if (!isAuthor) {
      const [room] = await db
        .select({ ownerId: rooms.ownerId })
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .limit(1);

      if (room?.ownerId !== userId && req.user!.role !== "admin") {
        throw new AppError(403, "Not authorized to delete this thread");
      }
    }

    await db.delete(roomThreads).where(eq(roomThreads.id, threadId));

    // Update thread count
    await db
      .update(rooms)
      .set({ threadCount: sql`GREATEST(${rooms.threadCount} - 1, 0)` })
      .where(eq(rooms.id, roomId));

    res.json({ success: true, data: { deleted: true } });
  }),
);

// PATCH /home/rooms/:roomId/threads/:threadId - Lock/pin thread
router.patch(
  "/rooms/:roomId/threads/:threadId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, threadId } = req.params;
    const data = updateThreadModerationSchema.parse(req.body);

    // Only room owner can lock/pin
    const [room] = await db
      .select({ ownerId: rooms.ownerId })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    if (room.ownerId !== userId && req.user!.role !== "admin") {
      throw new AppError(403, "Only the room owner can lock/pin threads");
    }

    const [thread] = await db
      .select()
      .from(roomThreads)
      .where(and(eq(roomThreads.id, threadId), eq(roomThreads.roomId, roomId)))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.isLocked !== undefined) updateData.isLocked = data.isLocked;
    if (data.isPinned !== undefined) updateData.isPinned = data.isPinned;

    const [updatedThread] = await db
      .update(roomThreads)
      .set(updateData)
      .where(eq(roomThreads.id, threadId))
      .returning();

    res.json({ success: true, data: updatedThread });
  }),
);

// DELETE /home/rooms/:roomId/threads/:threadId/comments/:commentId - Delete comment
router.delete(
  "/rooms/:roomId/threads/:threadId/comments/:commentId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, threadId, commentId } = req.params;

    const [thread] = await db
      .select()
      .from(roomThreads)
      .where(and(eq(roomThreads.id, threadId), eq(roomThreads.roomId, roomId)))
      .limit(1);

    if (!thread) {
      throw new AppError(404, "Thread not found");
    }

    const [comment] = await db
      .select()
      .from(roomComments)
      .where(
        and(
          eq(roomComments.id, commentId),
          eq(roomComments.threadId, threadId),
        ),
      )
      .limit(1);

    if (!comment) {
      throw new AppError(404, "Comment not found");
    }

    // Check permissions: author, room owner, or admin
    const isAuthor = comment.authorId === userId;
    if (!isAuthor) {
      const [room] = await db
        .select({ ownerId: rooms.ownerId })
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .limit(1);

      if (room?.ownerId !== userId && req.user!.role !== "admin") {
        throw new AppError(403, "Not authorized to delete this comment");
      }
    }

    await db.delete(roomComments).where(eq(roomComments.id, commentId));

    // Update reply count
    await db
      .update(roomThreads)
      .set({
        replyCount: sql`GREATEST(${roomThreads.replyCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(roomThreads.id, threadId));

    res.json({ success: true, data: { deleted: true } });
  }),
);

// POST /home/rooms/:roomId/invite - Invite user to private room
router.post(
  "/rooms/:roomId/invite",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const data = inviteSchema.parse(req.body);

    // Get room
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    if (room.ownerId !== userId) {
      throw new AppError(403, "Only the owner can invite members");
    }

    if (room.visibility !== "private") {
      throw new AppError(400, "Can only invite to private rooms");
    }

    // Find user by userId
    const [invitee] = await db
      .select()
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);

    if (!invitee) {
      throw new AppError(404, "User not found");
    }

    const inviteeId = invitee.id;

    // Check if already member
    const [existingMember] = await db
      .select()
      .from(roomMembers)
      .where(
        and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, inviteeId)),
      )
      .limit(1);

    if (existingMember) {
      throw new AppError(400, "User is already a member");
    }

    // Check for pending invitation
    const [existingInvite] = await db
      .select()
      .from(roomInvitations)
      .where(
        and(
          eq(roomInvitations.roomId, roomId),
          eq(roomInvitations.inviteeId, inviteeId),
          eq(roomInvitations.status, "pending"),
        ),
      )
      .limit(1);

    if (existingInvite) {
      throw new AppError(400, "Invitation already pending");
    }

    // Create invitation
    const [invitation] = await db
      .insert(roomInvitations)
      .values({
        roomId,
        inviterId: userId,
        inviteeId: inviteeId,
      })
      .returning();

    // Notify invitee
    const inviterName = req.user!.name || "Someone";
    await notify({
      userId: inviteeId,
      type: "room_invite",
      title: inviterName,
      body: room.name,
      link: "/home",
    });

    res.status(201).json({
      success: true,
      data: invitation,
    });
  }),
);

// POST /home/rooms/:roomId/members - Add member directly (owner only, private rooms)
router.post(
  "/rooms/:roomId/members",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const { userId: targetUserId } = z
      .object({ userId: z.string().uuid() })
      .parse(req.body);

    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    if (room.ownerId !== userId) {
      throw new AppError(403, "Only the owner can add members");
    }

    if (room.visibility !== "private") {
      throw new AppError(400, "Can only add members to private rooms");
    }

    // Verify target user exists
    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      throw new AppError(404, "User not found");
    }

    // Check if already member
    const [existingMember] = await db
      .select()
      .from(roomMembers)
      .where(
        and(
          eq(roomMembers.roomId, roomId),
          eq(roomMembers.userId, targetUserId),
        ),
      )
      .limit(1);

    if (existingMember) {
      throw new AppError(400, "User is already a member");
    }

    // Add member directly
    await db.insert(roomMembers).values({
      roomId,
      userId: targetUserId,
    });

    // Notify the added user
    const adderName = req.user!.name || "Someone";
    await notify({
      userId: targetUserId,
      type: "room_invite",
      title: adderName,
      body: room.name,
      link: `/home/rooms/${roomId}`,
    });

    res.status(201).json({
      success: true,
      data: { userId: targetUserId, name: targetUser.name },
    });
  }),
);

// DELETE /home/rooms/:roomId/members/:userId - Remove member (owner only) or leave room
router.delete(
  "/rooms/:roomId/members/:memberId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, memberId } = req.params;

    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    const isOwner = room.ownerId === userId;
    const isSelf = memberId === userId;

    if (!isOwner && !isSelf) {
      throw new AppError(403, "Can only remove yourself or be the owner");
    }

    await db
      .delete(roomMembers)
      .where(
        and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, memberId)),
      );

    res.json({
      success: true,
      data: { removed: true },
    });
  }),
);

// ============================================================
// CATCH-ALL: /:userId — must be LAST to avoid matching
// /invitations, /rooms, etc.
// ============================================================

// GET /home/:userId - Get user's home (public view)
router.get(
  "/:userId",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.params;
    const currentUserId = req.user?.id;

    // Get user
    const [homeOwner] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!homeOwner) {
      throw new AppError(404, "User not found");
    }

    const isOwnHome = currentUserId === userId;

    // Get rooms (public ones, or all if viewing own home)

    const roomsQuery = db
      .select({
        room: rooms,
        threadCount: sql<number>`(SELECT count(*)::int FROM room_threads WHERE room_id = ${rooms.id})`,
      })
      .from(rooms)
      .where(eq(rooms.ownerId, userId))
      .orderBy(desc(rooms.isPinned), rooms.sortOrder, desc(rooms.updatedAt));

    const userRooms = await roomsQuery;

    // Filter rooms based on visibility and membership
    const accessibleRooms = await Promise.all(
      userRooms.map(async ({ room, threadCount }) => {
        // Public rooms are always visible
        if (room.visibility === "public") {
          return { ...room, threadCount, canAccess: true };
        }

        // Private rooms: check if current user is owner or member
        if (isOwnHome) {
          return { ...room, threadCount, canAccess: true };
        }

        if (currentUserId) {
          const [membership] = await db
            .select()
            .from(roomMembers)
            .where(
              and(
                eq(roomMembers.roomId, room.id),
                eq(roomMembers.userId, currentUserId),
              ),
            )
            .limit(1);

          if (membership) {
            return { ...room, threadCount, canAccess: true };
          }
        }

        // Show that room exists but can't access
        return {
          id: room.id,
          name: room.name,
          visibility: room.visibility,
          isPinned: room.isPinned,
          canAccess: false,
        };
      }),
    );

    // Get recent activity (user's threads and comments)
    const recentThreads = await db
      .select({
        id: threads.id,
        title: threads.title,
        scope: threads.scope,
        createdAt: threads.createdAt,
      })
      .from(threads)
      .where(eq(threads.authorId, userId))
      .orderBy(desc(threads.createdAt))
      .limit(5);

    // Get user's club memberships
    const userClubs = await db
      .select({
        club: {
          id: clubs.id,
          name: clubs.name,
          slug: clubs.slug,
        },
      })
      .from(clubMembers)
      .innerJoin(clubs, eq(clubMembers.clubId, clubs.id))
      .where(eq(clubMembers.userId, userId))
      .limit(5);

    res.json({
      success: true,
      data: {
        owner: homeOwner,
        rooms: accessibleRooms,
        recentActivity: {
          threads: recentThreads,
          clubs: userClubs.map((c) => c.club),
        },
        isOwnHome,
      },
    });
  }),
);

export default router;
