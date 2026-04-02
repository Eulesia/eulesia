import { Router, type Response } from "express";
import { z } from "zod";
import { eq, desc, inArray, and, ne } from "drizzle-orm";
import {
  db,
  users,
  sessions,
  municipalities,
  threads,
  threadTags,
  institutionTopics,
} from "../db/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getSessionCookieOptions } from "../utils/cookies.js";
import { hashPassword, verifyPassword } from "../utils/crypto.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();

// Validation schemas
const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  municipalityId: z.string().uuid().optional().nullable(),
  locale: z.enum(["en", "fi", "sv"]).optional(),
  notificationReplies: z.boolean().optional(),
  notificationMentions: z.boolean().optional(),
  notificationOfficial: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

// GET /users/:id - Get user public profile with their public threads
router.get(
  "/:id",
  asyncHandler(async (req, res: Response) => {
    const { id } = req.params;

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        verifiedName: users.verifiedName,
        avatarUrl: users.avatarUrl,
        role: users.role,

        institutionType: users.institutionType,
        institutionName: users.institutionName,
        identityVerified: users.identityVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!user) {
      throw new AppError(404, "User not found");
    }

    // Get user's public Agora threads (not club threads or private content)
    const userThreads = await db
      .select({
        id: threads.id,
        title: threads.title,
        content: threads.content,
        scope: threads.scope,
        replyCount: threads.replyCount,
        score: threads.score,
        createdAt: threads.createdAt,
        updatedAt: threads.updatedAt,
        municipalityId: threads.municipalityId,
        municipalityName: municipalities.name,
      })
      .from(threads)
      .leftJoin(municipalities, eq(threads.municipalityId, municipalities.id))
      .where(and(eq(threads.authorId, id), eq(threads.isHidden, false)))
      .orderBy(desc(threads.createdAt))
      .limit(20);

    // Get tags for threads
    const threadIds = userThreads.map((t) => t.id);
    const allTags =
      threadIds.length > 0
        ? await db
            .select()
            .from(threadTags)
            .where(inArray(threadTags.threadId, threadIds))
        : [];

    // Build tags map
    const tagsByThread: Record<string, string[]> = {};
    for (const tag of allTags) {
      if (!tagsByThread[tag.threadId]) tagsByThread[tag.threadId] = [];
      tagsByThread[tag.threadId].push(tag.tag);
    }

    // For institutions, fetch topic info and separate threads by type
    let institutionTopic = null;
    let botSummaries: typeof userThreads = [];
    let citizenDiscussions: typeof userThreads = [];

    if (user.role === "institution") {
      // Get institution topic
      const [topic] = await db
        .select()
        .from(institutionTopics)
        .where(eq(institutionTopics.institutionId, id))
        .limit(1);

      if (topic) {
        institutionTopic = topic;
      }

      // Get bot summaries (threads where this institution is the source)
      const botThreads = await db
        .select({
          id: threads.id,
          title: threads.title,
          content: threads.content,
          scope: threads.scope,
          replyCount: threads.replyCount,
          score: threads.score,
          createdAt: threads.createdAt,
          updatedAt: threads.updatedAt,
          municipalityId: threads.municipalityId,
          municipalityName: municipalities.name,
        })
        .from(threads)
        .leftJoin(municipalities, eq(threads.municipalityId, municipalities.id))
        .where(
          and(eq(threads.sourceInstitutionId, id), eq(threads.isHidden, false)),
        )
        .orderBy(desc(threads.createdAt))
        .limit(20);

      botSummaries = botThreads;

      // Get citizen discussions (threads tagged with topic tag, NOT authored by bot)
      if (topic) {
        const taggedThreadIds = await db
          .select({ threadId: threadTags.threadId })
          .from(threadTags)
          .where(eq(threadTags.tag, topic.topicTag));

        const taggedIds = taggedThreadIds.map((t) => t.threadId);
        if (taggedIds.length > 0) {
          const citizenThreads = await db
            .select({
              id: threads.id,
              title: threads.title,
              content: threads.content,
              scope: threads.scope,
              replyCount: threads.replyCount,
              score: threads.score,
              createdAt: threads.createdAt,
              updatedAt: threads.updatedAt,
              municipalityId: threads.municipalityId,
              municipalityName: municipalities.name,
            })
            .from(threads)
            .leftJoin(
              municipalities,
              eq(threads.municipalityId, municipalities.id),
            )
            .where(
              and(
                inArray(threads.id, taggedIds),
                eq(threads.source, "user"),
                eq(threads.isHidden, false),
              ),
            )
            .orderBy(desc(threads.createdAt))
            .limit(20);

          citizenDiscussions = citizenThreads;
        }
      }

      // Get tags for bot summaries and citizen discussions
      const allExtraIds = [...botSummaries, ...citizenDiscussions].map(
        (t) => t.id,
      );
      if (allExtraIds.length > 0) {
        const extraTags = await db
          .select()
          .from(threadTags)
          .where(inArray(threadTags.threadId, allExtraIds));
        for (const tag of extraTags) {
          if (!tagsByThread[tag.threadId]) tagsByThread[tag.threadId] = [];
          tagsByThread[tag.threadId].push(tag.tag);
        }
      }
    }

    res.json({
      success: true,
      data: {
        ...user,
        threads: userThreads.map((t) => ({
          ...t,
          tags: tagsByThread[t.id] || [],
        })),
        // Institution-specific fields
        ...(user.role === "institution"
          ? {
              institutionTopic,
              botSummaries: botSummaries.map((t) => ({
                ...t,
                tags: tagsByThread[t.id] || [],
              })),
              citizenDiscussions: citizenDiscussions.map((t) => ({
                ...t,
                tags: tagsByThread[t.id] || [],
              })),
            }
          : {}),
      },
    });
  }),
);

// PATCH /users/me - Update own profile
router.patch(
  "/me",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const currentUser = req.user!;
    const userId = currentUser.id;
    const updates = updateUserSchema.parse(req.body);

    if (
      currentUser.identityVerified &&
      typeof updates.name === "string" &&
      updates.name !== currentUser.name
    ) {
      throw new AppError(
        400,
        "Verified accounts cannot change their display name",
      );
    }

    // Validate municipality if provided
    if (updates.municipalityId) {
      const [muni] = await db
        .select()
        .from(municipalities)
        .where(eq(municipalities.id, updates.municipalityId))
        .limit(1);

      if (!muni) {
        throw new AppError(400, "Invalid municipality");
      }
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    res.json({ success: true, data: updatedUser });
  }),
);

// POST /users/me/password - Change own password
router.post(
  "/me/password",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const passwordHash = req.user!.passwordHash;

    if (!passwordHash) {
      throw new AppError(400, "This account does not support password changes");
    }

    const { currentPassword, newPassword } = changePasswordSchema.parse(
      req.body,
    );

    const currentPasswordMatches = await verifyPassword(
      passwordHash,
      currentPassword,
    );

    if (!currentPasswordMatches) {
      throw new AppError(400, "Current password is incorrect");
    }

    const nextPasswordHash = await hashPassword(newPassword);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash: nextPasswordHash,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      if (req.sessionId) {
        await tx
          .delete(sessions)
          .where(
            and(eq(sessions.userId, userId), ne(sessions.id, req.sessionId)),
          );
      } else {
        await tx.delete(sessions).where(eq(sessions.userId, userId));
      }
    });

    res.json({
      success: true,
      data: { changed: true },
    });
  }),
);

// POST /users/me/onboarding-complete - Mark onboarding as completed
router.post(
  "/me/onboarding-complete",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;

    await db
      .update(users)
      .set({ onboardingCompletedAt: new Date() })
      .where(eq(users.id, userId));

    res.json({ success: true });
  }),
);

// GET /users/me/data - GDPR data export (Article 15 & 20 — right of access & portability)
router.get(
  "/me/data",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;

    const {
      threads,
      comments,
      clubMembers,
      rooms,
      roomThreads,
      roomComments,
      roomMembers,
      notifications,
      userSubscriptions,
      threadVotes,
      commentVotes,
      directMessages,
      conversationParticipants,
      sessions,
      userSanctions,
      moderationAppeals,
      contentReports,
      editHistory,
      inviteCodes,
      roomInvitations,
    } = await import("../db/index.js");

    // User profile (exclude passwordHash)
    const [userData] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    const { passwordHash: _pw, ...safeUserData } =
      userData || ({} as Record<string, unknown>);

    // Content authored by user
    const userThreads = await db
      .select()
      .from(threads)
      .where(eq(threads.authorId, userId));
    const userComments = await db
      .select()
      .from(comments)
      .where(eq(comments.authorId, userId));
    const userRoomThreads = await db
      .select()
      .from(roomThreads)
      .where(eq(roomThreads.authorId, userId));
    const userRoomComments = await db
      .select()
      .from(roomComments)
      .where(eq(roomComments.authorId, userId));

    // Votes
    const userThreadVotes = await db
      .select()
      .from(threadVotes)
      .where(eq(threadVotes.userId, userId));
    const userCommentVotes = await db
      .select()
      .from(commentVotes)
      .where(eq(commentVotes.userId, userId));

    // Direct messages
    const userConversations = await db
      .select()
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, userId));
    const conversationIds = userConversations.map((c) => c.conversationId);
    const userDMs =
      conversationIds.length > 0
        ? await db
            .select()
            .from(directMessages)
            .where(inArray(directMessages.conversationId, conversationIds))
        : [];

    // Memberships
    const userClubMemberships = await db
      .select()
      .from(clubMembers)
      .where(eq(clubMembers.userId, userId));
    const userRoomMemberships = await db
      .select()
      .from(roomMembers)
      .where(eq(roomMembers.userId, userId));
    const userOwnedRooms = await db
      .select()
      .from(rooms)
      .where(eq(rooms.ownerId, userId));

    // Invitations (sent and received)
    const sentRoomInvitations = await db
      .select()
      .from(roomInvitations)
      .where(eq(roomInvitations.inviterId, userId));
    const receivedRoomInvitations = await db
      .select()
      .from(roomInvitations)
      .where(eq(roomInvitations.inviteeId, userId));

    // Notifications & subscriptions
    const userNotifications = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId));
    const userSubs = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId));

    // Sessions (exclude tokenHash for security)
    const userSessions = (
      await db.select().from(sessions).where(eq(sessions.userId, userId))
    ).map(({ tokenHash: _t, ...s }) => s);

    // Moderation data related to user
    const userSanctionRecords = await db
      .select()
      .from(userSanctions)
      .where(eq(userSanctions.userId, userId));
    const userAppeals = await db
      .select()
      .from(moderationAppeals)
      .where(eq(moderationAppeals.userId, userId));
    const userReports = await db
      .select()
      .from(contentReports)
      .where(eq(contentReports.reporterUserId, userId));

    // Edit history (edits made by user)
    const userEdits = await db
      .select()
      .from(editHistory)
      .where(eq(editHistory.editedBy, userId));

    // Invite codes created by user
    const userInviteCodes = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.createdBy, userId));

    res.json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        user: safeUserData,
        threads: userThreads,
        comments: userComments,
        threadVotes: userThreadVotes,
        commentVotes: userCommentVotes,
        directMessages: userDMs,
        conversations: userConversations,
        clubMemberships: userClubMemberships,
        rooms: userOwnedRooms,
        roomMemberships: userRoomMemberships,
        roomThreads: userRoomThreads,
        roomComments: userRoomComments,
        roomInvitations: {
          sent: sentRoomInvitations,
          received: receivedRoomInvitations,
        },
        notifications: userNotifications,
        subscriptions: userSubs,
        sessions: userSessions,
        sanctions: userSanctionRecords,
        appeals: userAppeals,
        reports: userReports,
        editHistory: userEdits,
        inviteCodes: userInviteCodes,
      },
    });
  }),
);

// DELETE /users/me - GDPR account deletion ("right to be forgotten")
// Soft-deletes: anonymizes user data, removes personal info, keeps public content
router.delete(
  "/me",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;

    const {
      notifications,
      userSubscriptions,
      directMessages,
      conversationParticipants,
      threadVotes,
      commentVotes,
      roomThreads,
      roomComments,
      roomThreadVotes,
      roomCommentVotes,
      clubMembers,
      editHistory,
    } = await import("../db/index.js");

    // 1. Delete user's votes
    await db.delete(threadVotes).where(eq(threadVotes.userId, userId));
    await db.delete(commentVotes).where(eq(commentVotes.userId, userId));

    // 2. Delete notifications
    await db.delete(notifications).where(eq(notifications.userId, userId));

    // 3. Delete subscriptions (both directions)
    await db
      .delete(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId));

    // 4. Delete DMs and conversation participation
    await db.delete(directMessages).where(eq(directMessages.authorId, userId));
    await db
      .delete(conversationParticipants)
      .where(eq(conversationParticipants.userId, userId));

    // 5. Delete room content
    await db
      .delete(roomCommentVotes)
      .where(eq(roomCommentVotes.userId, userId));
    await db.delete(roomThreadVotes).where(eq(roomThreadVotes.userId, userId));
    await db.delete(roomComments).where(eq(roomComments.authorId, userId));
    await db.delete(roomThreads).where(eq(roomThreads.authorId, userId));

    // 6. Delete club memberships
    await db.delete(clubMembers).where(eq(clubMembers.userId, userId));

    // 7. Delete edit history
    await db.delete(editHistory).where(eq(editHistory.editedBy, userId));

    // 8. Anonymize the user account (keep row for FK integrity, remove all personal data)
    // Public threads and comments keep their authorId but the user is now "[Poistettu käyttäjä]"
    await db
      .update(users)
      .set({
        name: "[Poistettu käyttäjä]",
        email: `deleted_${userId}@deleted.eulesia.eu`,
        username: `deleted_${userId.slice(0, 8)}`,
        passwordHash: "",
        avatarUrl: null,
        municipalityId: null,
        role: "citizen",
        institutionType: null,
        institutionName: null,
        // Clear strong auth / identity fields
        identityVerified: false,
        identityProvider: null,
        identityLevel: "basic",
        verifiedName: null,
        rpSubject: null,
        identityIssuer: null,
        identityVerifiedAt: null,
        // Clear preferences
        notificationReplies: false,
        notificationMentions: false,
        notificationOfficial: false,
        locale: null,
        onboardingCompletedAt: null,
        lastSeenAt: null,
        deletedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // 9. Clear session cookie
    res.clearCookie("session", getSessionCookieOptions(req));

    res.json({
      success: true,
      data: { deleted: true },
    });
  }),
);

export default router;
