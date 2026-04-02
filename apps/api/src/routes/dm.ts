import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, sql, gt, inArray } from "drizzle-orm";
import {
  db,
  conversations,
  conversationParticipants,
  directMessages,
  users,
  notifications,
  editHistory,
} from "../db/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { renderMarkdown } from "../utils/markdown.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { io } from "../index.js";
import { notify } from "../services/notify.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();

// Validation schemas
const startConversationSchema = z.object({
  userId: z.string().uuid(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

// GET /dm — List user's conversations
router.get(
  "/",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;

    // Get all conversation IDs where user is a participant
    const participations = await db
      .select({
        conversationId: conversationParticipants.conversationId,
        lastReadAt: conversationParticipants.lastReadAt,
      })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, userId));

    if (participations.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const conversationIds = participations.map((p) => p.conversationId);
    const lastReadMap = new Map(
      participations.map((p) => [p.conversationId, p.lastReadAt]),
    );

    // Get conversations with their data
    const convos = await db
      .select()
      .from(conversations)
      .where(inArray(conversations.id, conversationIds))
      .orderBy(desc(conversations.updatedAt));

    // Build result for each conversation
    const result = await Promise.all(
      convos.map(async (conv) => {
        // Get the other participant
        const otherParticipants = await db
          .select({ user: users })
          .from(conversationParticipants)
          .innerJoin(users, eq(conversationParticipants.userId, users.id))
          .where(
            and(
              eq(conversationParticipants.conversationId, conv.id),
              sql`${conversationParticipants.userId} != ${userId}`,
            ),
          );

        const otherUser = otherParticipants[0]?.user;

        // Get latest message
        const [latestMessage] = await db
          .select({
            message: directMessages,
            author: users,
          })
          .from(directMessages)
          .innerJoin(users, eq(directMessages.authorId, users.id))
          .where(eq(directMessages.conversationId, conv.id))
          .orderBy(desc(directMessages.createdAt))
          .limit(1);

        // Count unread messages
        const lastRead = lastReadMap.get(conv.id);
        const [unreadResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(directMessages)
          .where(
            and(
              eq(directMessages.conversationId, conv.id),
              sql`${directMessages.authorId} != ${userId}`,
              lastRead ? gt(directMessages.createdAt, lastRead) : sql`true`,
            ),
          );

        return {
          id: conv.id,
          otherUser: otherUser ?? null,
          lastMessage: latestMessage
            ? {
                id: latestMessage.message.id,
                conversationId: latestMessage.message.conversationId,
                content: latestMessage.message.content,
                contentHtml: latestMessage.message.contentHtml,
                author: latestMessage.author,
                createdAt: latestMessage.message.createdAt?.toISOString(),
              }
            : null,
          unreadCount: unreadResult?.count ?? 0,
          updatedAt: conv.updatedAt?.toISOString(),
        };
      }),
    );

    res.json({ success: true, data: result });
  }),
);

// POST /dm — Start or find existing conversation
router.post(
  "/",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const currentUserId = req.user!.id;
    const { userId: otherUserId } = startConversationSchema.parse(req.body);

    if (currentUserId === otherUserId) {
      throw new AppError(400, "Cannot start a conversation with yourself");
    }

    // Check other user exists
    const [otherUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, otherUserId))
      .limit(1);

    if (!otherUser) {
      throw new AppError(404, "User not found");
    }

    // Find existing conversation between these two users
    const existingConversation = await db.execute(sql`
    SELECT cp1.conversation_id
    FROM conversation_participants cp1
    INNER JOIN conversation_participants cp2
      ON cp1.conversation_id = cp2.conversation_id
    WHERE cp1.user_id = ${currentUserId}
      AND cp2.user_id = ${otherUserId}
    LIMIT 1
  `);

    if (existingConversation.length > 0) {
      const convId = existingConversation[0].conversation_id as string;
      return res.json({
        success: true,
        data: {
          id: convId,
          otherUser,
          lastMessage: null,
          unreadCount: 0,
          updatedAt: new Date().toISOString(),
        },
      });
    }

    // Create new conversation
    const [conv] = await db.insert(conversations).values({}).returning();

    // Add both participants
    await db.insert(conversationParticipants).values([
      { conversationId: conv.id, userId: currentUserId },
      { conversationId: conv.id, userId: otherUserId },
    ]);

    res.status(201).json({
      success: true,
      data: {
        id: conv.id,
        otherUser,
        lastMessage: null,
        unreadCount: 0,
        updatedAt: conv.updatedAt?.toISOString(),
      },
    });
  }),
);

// GET /dm/unread-count — Get total unread DM count across all conversations
router.get(
  "/unread-count",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;

    const participations = await db
      .select({
        conversationId: conversationParticipants.conversationId,
        lastReadAt: conversationParticipants.lastReadAt,
      })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, userId));

    if (participations.length === 0) {
      return res.json({ success: true, data: { count: 0 } });
    }

    let totalUnread = 0;
    for (const p of participations) {
      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(directMessages)
        .where(
          and(
            eq(directMessages.conversationId, p.conversationId),
            sql`${directMessages.authorId} != ${userId}`,
            p.lastReadAt
              ? gt(directMessages.createdAt, p.lastReadAt)
              : sql`true`,
          ),
        );
      totalUnread += result?.count ?? 0;
    }

    res.json({ success: true, data: { count: totalUnread } });
  }),
);

// GET /dm/:conversationId — Get conversation with messages
router.get(
  "/:conversationId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { conversationId } = req.params;
    const { limit = "50" } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));

    // Verify user is a participant
    const [participation] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);

    if (!participation) {
      throw new AppError(403, "Not a participant in this conversation");
    }

    // Get the other participant
    const otherParticipants = await db
      .select({ user: users })
      .from(conversationParticipants)
      .innerJoin(users, eq(conversationParticipants.userId, users.id))
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          sql`${conversationParticipants.userId} != ${userId}`,
        ),
      );

    const otherUser = otherParticipants[0]?.user;

    // Get messages (newest first, then reverse for display; include hidden as stubs)
    const messagesData = await db
      .select({
        message: directMessages,
        author: users,
      })
      .from(directMessages)
      .innerJoin(users, eq(directMessages.authorId, users.id))
      .where(eq(directMessages.conversationId, conversationId))
      .orderBy(desc(directMessages.createdAt))
      .limit(limitNum);

    res.json({
      success: true,
      data: {
        id: conversationId,
        otherUser: otherUser ?? null,
        messages: messagesData
          .map(({ message, author }) => {
            if (message.isHidden) {
              return {
                id: message.id,
                conversationId: message.conversationId,
                content: "",
                contentHtml: null,
                author: null,
                editedAt: null,
                createdAt: message.createdAt?.toISOString(),
                isHidden: true,
              };
            }
            return {
              id: message.id,
              conversationId: message.conversationId,
              content: message.content,
              contentHtml: message.contentHtml,
              author,
              editedAt: message.editedAt?.toISOString() || null,
              createdAt: message.createdAt?.toISOString(),
            };
          })
          .reverse(), // Oldest first
      },
    });
  }),
);

// POST /dm/:conversationId/messages — Send a message
router.post(
  "/:conversationId/messages",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { conversationId } = req.params;
    const { content } = sendMessageSchema.parse(req.body);

    // Verify user is a participant
    const [participation] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);

    if (!participation) {
      throw new AppError(403, "Not a participant in this conversation");
    }

    // Parse markdown
    const contentHtml = renderMarkdown(content);

    // Create message
    const [message] = await db
      .insert(directMessages)
      .values({
        conversationId,
        authorId: userId,
        content,
        contentHtml,
      })
      .returning();

    // Update conversation timestamp
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    // Get author info
    const [author] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const messageData = {
      id: message.id,
      conversationId: message.conversationId,
      content: message.content,
      contentHtml: message.contentHtml,
      author,
      createdAt: message.createdAt?.toISOString(),
    };

    // Emit socket event
    io.to(`dm:${conversationId}`).emit("new_dm_message", {
      conversationId,
      message: messageData,
    });

    // Create notification for the other participant
    const otherParticipants = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          sql`${conversationParticipants.userId} != ${userId}`,
        ),
      );

    const otherUserId = otherParticipants[0]?.userId;
    if (otherUserId) {
      const truncatedBody =
        content.length > 100 ? content.slice(0, 100) + "..." : content;

      await notify({
        userId: otherUserId,
        type: "dm",
        title: author.name,
        body: truncatedBody,
        link: `/messages/${conversationId}`,
      });
    }

    res.status(201).json({
      success: true,
      data: messageData,
    });
  }),
);

// PATCH /dm/:conversationId/messages/:messageId — Edit a DM
router.patch(
  "/:conversationId/messages/:messageId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { conversationId, messageId } = req.params;
    const { content } = z
      .object({ content: z.string().min(1).max(5000) })
      .parse(req.body);

    // Verify user is a participant
    const [participation] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);

    if (!participation) {
      throw new AppError(403, "Not a participant in this conversation");
    }

    const [message] = await db
      .select()
      .from(directMessages)
      .where(
        and(
          eq(directMessages.id, messageId),
          eq(directMessages.conversationId, conversationId),
        ),
      )
      .limit(1);

    if (!message) {
      throw new AppError(404, "Message not found");
    }

    if (message.authorId !== userId) {
      throw new AppError(403, "Can only edit your own messages");
    }

    // Save previous content
    await db.insert(editHistory).values({
      contentType: "dm",
      contentId: messageId,
      editedBy: userId,
      previousContent: message.content,
      previousContentHtml: message.contentHtml,
    });

    const contentHtml = renderMarkdown(content);

    const [updated] = await db
      .update(directMessages)
      .set({
        content,
        contentHtml,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(directMessages.id, messageId))
      .returning();

    const [author] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    io.to(`dm:${conversationId}`).emit("dm_message_edited", {
      conversationId,
      messageId,
      content: updated.content,
      contentHtml: updated.contentHtml,
      editedAt: updated.editedAt,
      author,
    });

    res.json({ success: true, data: updated });
  }),
);

// DELETE /dm/:conversationId/messages/:messageId — Soft-delete a DM
router.delete(
  "/:conversationId/messages/:messageId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { conversationId, messageId } = req.params;

    // Verify user is a participant
    const [participation] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);

    if (!participation) {
      throw new AppError(403, "Not a participant in this conversation");
    }

    const [message] = await db
      .select()
      .from(directMessages)
      .where(
        and(
          eq(directMessages.id, messageId),
          eq(directMessages.conversationId, conversationId),
        ),
      )
      .limit(1);

    if (!message) {
      throw new AppError(404, "Message not found");
    }

    if (message.authorId !== userId) {
      throw new AppError(403, "Can only delete your own messages");
    }

    await db
      .update(directMessages)
      .set({ isHidden: true, updatedAt: new Date() })
      .where(eq(directMessages.id, messageId));

    io.to(`dm:${conversationId}`).emit("dm_message_deleted", {
      conversationId,
      messageId,
    });

    res.json({ success: true, data: { deleted: true } });
  }),
);

// POST /dm/:conversationId/read — Mark conversation as read + dismiss related notifications
router.post(
  "/:conversationId/read",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { conversationId } = req.params;

    // Update lastReadAt
    await db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      );

    // Mark related DM notifications as read
    await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, "dm"),
          sql`${notifications.link} = ${`/messages/${conversationId}`}`,
        ),
      );

    res.json({ success: true, data: { read: true } });
  }),
);

export default router;
