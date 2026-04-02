import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, gt, or, lt } from "drizzle-orm";
import * as argon2 from "argon2";
import expressSession from "express-session";
import {
  db,
  users,
  magicLinks,
  sessions,
  siteSettings,
  ftnPendingRegistrations,
  inviteCodes,
} from "../db/index.js";
import {
  generateMagicLinkToken,
  generateSessionToken,
  generateToken,
  hashToken,
} from "../utils/crypto.js";
import { emailService } from "../services/email.js";
import { authMiddleware } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { env } from "../utils/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getSessionCookieOptions,
  shouldUseSecureCookies,
} from "../utils/cookies.js";
import {
  formatBlockingSanctionResponse,
  getActiveBlockingSanction,
} from "../utils/sanctions.js";
import {
  buildIduraAuthorizeUrl,
  completeIduraAuthentication,
  getFtnFailureCodeFromError,
  getFtnFailureCodeFromIdura,
  getFtnFailureRedirect,
  isIduraFtnEnabled,
} from "../services/iduraFtn.js";
import { indexUser } from "../services/search/meilisearch.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();
const ftnEnabled = isIduraFtnEnabled();

function isUniqueViolationForConstraint(
  error: unknown,
  constraintName: string,
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const databaseError = error as {
    code?: string;
    constraint_name?: string;
    constraint?: string;
    message?: string;
  };

  return (
    databaseError.code === "23505" &&
    (databaseError.constraint_name === constraintName ||
      databaseError.constraint === constraintName ||
      databaseError.message?.includes(constraintName) === true)
  );
}

async function isRegistrationOpen() {
  const [regSetting] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, "registration_open"))
    .limit(1);

  return regSetting?.value !== "false";
}

// Validation schemas
const magicLinkSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const verifySchema = z.object({
  token: z.string().min(1, "Token is required"),
});

const registerSchema = z.object({
  inviteCode: z.string().min(1, "Invite code is required").optional(),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(2).max(255),
  ftnToken: z.string().optional(),
});

const loginSchema = z.object({
  username: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});

// ============================================
// FTN (Finnish Trust Network) via Idura Verify
// ============================================

async function saveSession(req: Request): Promise<void> {
  if (!req.session) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function clearFtnSession(req: Request): Promise<void> {
  if (!req.session) {
    return;
  }

  delete req.session.inviteCode;
  delete req.session.ftnNonce;
  delete req.session.ftnState;

  await saveSession(req);
}

// Only initialize Idura if credentials are configured
if (ftnEnabled) {
  // express-session middleware for FTN routes only (SDK needs it for OIDC state/nonce)
  const ftnSession = expressSession({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 5 * 60 * 1000,
      sameSite: "lax",
      secure: shouldUseSecureCookies(),
    }, // 5 min – only needed during OIDC flow
  });

  // Apply session middleware only to FTN routes
  router.use("/ftn", ftnSession);

  // GET /auth/ftn/start - Begin FTN authentication
  router.get(
    "/ftn/start",
    asyncHandler(async (req, res: Response) => {
      const invite = req.query.invite || req.query.inviteCode;
      const state = generateToken(24);
      const nonce = generateToken(24);

      req.session.ftnState = state;
      req.session.ftnNonce = nonce;
      req.session.inviteCode =
        typeof invite === "string" && invite.length > 0 ? invite : undefined;
      await saveSession(req);

      try {
        const authorizeUrl = await buildIduraAuthorizeUrl({
          nonce,
          state,
        });
        res.redirect(authorizeUrl.href);
      } catch (error) {
        await clearFtnSession(req);
        throw error;
      }
    }),
  );

  // GET /auth/ftn/callback - Handle Idura callback with JWT claims
  router.get(
    "/ftn/callback",
    asyncHandler(async (req, res: Response) => {
      if (req.query.error) {
        await clearFtnSession(req);
        return res.redirect(
          getFtnFailureRedirect(
            getFtnFailureCodeFromIdura({
              error:
                typeof req.query.error === "string"
                  ? req.query.error
                  : undefined,
              errorDescription:
                typeof req.query.error_description === "string"
                  ? req.query.error_description
                  : undefined,
            }),
          ),
        );
      }

      const code =
        typeof req.query.code === "string" ? req.query.code : undefined;
      const returnedState =
        typeof req.query.state === "string" ? req.query.state : undefined;
      const expectedState = req.session.ftnState;
      const expectedNonce = req.session.ftnNonce;
      const inviteCode = req.session.inviteCode ?? null;

      if (!code || !returnedState || !expectedState || !expectedNonce) {
        await clearFtnSession(req);
        return res.redirect(getFtnFailureRedirect("missing_ftn_session"));
      }

      if (returnedState !== expectedState) {
        await clearFtnSession(req);
        return res.redirect(getFtnFailureRedirect("invalid_state"));
      }

      let claims;

      try {
        claims = await completeIduraAuthentication({
          code,
          expectedNonce,
        });
      } catch (error) {
        await clearFtnSession(req);
        console.error("FTN callback failed:", error);
        return res.redirect(
          getFtnFailureRedirect(getFtnFailureCodeFromError(error)),
        );
      }

      await clearFtnSession(req);

      // Check for duplicate identity (one-person-one-account)
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.rpSubject, claims.sub))
        .limit(1);

      if (existing) {
        return res.redirect(getFtnFailureRedirect("duplicate_identity"));
      }

      // Create temporary token to bridge claims to registration form
      const ftnToken = generateToken(32);

      await db.insert(ftnPendingRegistrations).values({
        token: hashToken(ftnToken),
        givenName: claims.given_name,
        familyName: claims.family_name,
        sub: claims.sub,
        country: claims.country || "FI",
        inviteCode,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
      });

      // Clean up expired pending registrations (housekeeping)
      await db
        .delete(ftnPendingRegistrations)
        .where(lt(ftnPendingRegistrations.expiresAt, new Date()))
        .catch(() => {}); // Non-critical

      // Normalize FTN names only if ALL UPPER CASE (e.g. Nordea)
      const normalizeName = (s: string) =>
        s === s.toUpperCase()
          ? s.toLowerCase().replace(/(?:^|\s|-)\S/g, (c) => c.toUpperCase())
          : s;
      const params = new URLSearchParams({
        ftn: ftnToken,
        firstName: normalizeName(claims.given_name),
        lastName: normalizeName(claims.family_name),
        ...(inviteCode ? { invite: inviteCode } : {}),
      });
      res.redirect(`${env.APP_URL}/register?${params.toString()}`);
    }),
  );
}

// GET /auth/ftn/error - Handle FTN authentication errors
router.get("/ftn/error", (req, res) => {
  res.redirect(
    getFtnFailureRedirect(
      getFtnFailureCodeFromIdura({
        error:
          typeof req.query.error === "string" ? req.query.error : undefined,
        errorDescription:
          typeof req.query.error_description === "string"
            ? req.query.error_description
            : undefined,
      }),
    ),
  );
});

router.get(
  "/config",
  asyncHandler(async (_req, res: Response) => {
    res.json({
      success: true,
      data: {
        registrationMode: env.AUTH_REGISTRATION_MODE,
        registrationOpen: await isRegistrationOpen(),
        ftnEnabled,
      },
    });
  }),
);

// POST /auth/magic-link - Request a magic link
router.post(
  "/magic-link",
  asyncHandler(async (req, res: Response) => {
    const { email } = magicLinkSchema.parse(req.body);
    const normalizedEmail = email.toLowerCase();

    // Generate token
    const { token, hash } = generateMagicLinkToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store magic link
    await db.insert(magicLinks).values({
      email: normalizedEmail,
      tokenHash: hash,
      expiresAt,
    });

    // Send email
    await emailService.sendMagicLink(email, token);

    // In development, return the login URL directly for easy testing
    if (env.NODE_ENV === "development") {
      const loginUrl = `${env.API_URL}/api/v1/auth/verify/${token}`;
      res.json({
        success: true,
        message: "If an account exists, you will receive a login link",
        // DEV ONLY - login URL for testing
        _dev: {
          loginUrl,
          note: "This field only appears in development mode",
        },
      });
      return;
    }

    res.json({
      success: true,
      message: "If an account exists, you will receive a login link",
    });
  }),
);

// POST /auth/register - Register with FTN, username and password
router.post(
  "/register",
  asyncHandler(async (req, res: Response) => {
    const registrationMode = env.AUTH_REGISTRATION_MODE;
    const inviteRequired = registrationMode === "invite-only";
    const { inviteCode, username, password, name, ftnToken } =
      registerSchema.parse(req.body);

    if (!(await isRegistrationOpen())) {
      throw new AppError(403, "Registration is currently closed");
    }

    // Resolve FTN claims if ftnToken provided (strong authentication)
    let ftnClaims: {
      givenName: string;
      familyName: string;
      sub: string;
      country: string | null;
    } | null = null;
    let pendingInviteCode: string | null = null;
    let pendingRegistrationTokenHash: string | null = null;
    if (ftnToken) {
      pendingRegistrationTokenHash = hashToken(ftnToken);
      const [pending] = await db
        .select()
        .from(ftnPendingRegistrations)
        .where(
          and(
            eq(ftnPendingRegistrations.token, pendingRegistrationTokenHash),
            gt(ftnPendingRegistrations.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (!pending) {
        throw new AppError(
          400,
          "Invalid or expired FTN token. Please authenticate again.",
        );
      }

      // Check duplicate identity
      const [existingIdentity] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.rpSubject, pending.sub))
        .limit(1);

      if (existingIdentity) {
        throw new AppError(
          400,
          "This identity is already linked to another account",
        );
      }

      ftnClaims = {
        givenName: pending.givenName,
        familyName: pending.familyName,
        sub: pending.sub,
        country: pending.country,
      };
      pendingInviteCode = pending.inviteCode;
    }

    if (!inviteRequired && !ftnClaims) {
      throw new AppError(
        403,
        "Registration on this deployment requires FTN authentication",
      );
    }

    // Hash password before transaction (CPU-intensive work outside tx)
    const passwordHash = await argon2.hash(password);

    // Use transaction to prevent race conditions on username registration
    let newUser;
    try {
      newUser = await db.transaction(async (tx) => {
        let inviteId: string | null = null;
        let invitedByUserId: string | null = null;
        const resolvedInviteCode = pendingInviteCode ?? inviteCode ?? null;

        if (inviteRequired) {
          if (!resolvedInviteCode) {
            throw new AppError(400, "Invite code is required");
          }

          const [invite] = await tx
            .select()
            .from(inviteCodes)
            .where(eq(inviteCodes.code, resolvedInviteCode.toUpperCase()))
            .limit(1);

          if (!invite) {
            throw new AppError(400, "Invalid invite code");
          }

          if (invite.status !== "available") {
            throw new AppError(400, "Invite code has already been used");
          }

          if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
            throw new AppError(400, "Invite code has expired");
          }

          inviteId = invite.id;
          invitedByUserId = invite.createdBy;
        }

        // Check if username already exists
        const [existing] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.username, username.toLowerCase()))
          .limit(1);

        if (existing) {
          throw new AppError(400, "Username already exists");
        }

        // Normalize FTN names only if ALL UPPER CASE (e.g. Nordea)
        const normalizeName = (s: string) =>
          s === s.toUpperCase()
            ? s.toLowerCase().replace(/(?:^|\s|-)\S/g, (c) => c.toUpperCase())
            : s;

        const ftnDisplayName = ftnClaims
          ? `${normalizeName(ftnClaims.givenName.split(" ")[0])} ${normalizeName(ftnClaims.familyName)}`
          : null;
        const ftnVerifiedName = ftnClaims
          ? `${normalizeName(ftnClaims.givenName)} ${normalizeName(ftnClaims.familyName)}`
          : null;

        // Create user — with FTN strong auth data if available
        const [created] = await tx
          .insert(users)
          .values({
            username: username.toLowerCase(),
            passwordHash,
            name: ftnDisplayName ?? name,
            invitedBy: invitedByUserId,
            inviteCodesRemaining: 5,
            identityProvider: ftnClaims ? "ftn" : "invite",
            identityVerified: !!ftnClaims,
            identityLevel: ftnClaims ? "substantial" : "basic",
            ...(ftnClaims
              ? {
                  verifiedName: ftnVerifiedName,
                  rpSubject: ftnClaims.sub,
                  identityIssuer: "idura_ftn",
                  identityVerifiedAt: new Date(),
                }
              : {}),
          })
          .returning();

        if (inviteId) {
          await tx
            .update(inviteCodes)
            .set({
              usedBy: created.id,
              status: "used",
              usedAt: new Date(),
            })
            .where(eq(inviteCodes.id, inviteId));
        }

        return created;
      });
    } catch (error) {
      if (isUniqueViolationForConstraint(error, "users_rp_subject_idx")) {
        throw new AppError(
          400,
          "This identity is already linked to another account",
        );
      }

      throw error;
    }

    if (pendingRegistrationTokenHash) {
      await db
        .delete(ftnPendingRegistrations)
        .where(eq(ftnPendingRegistrations.token, pendingRegistrationTokenHash));
    }

    // Index new user in Meilisearch (outside tx — not critical)
    try {
      await indexUser({
        id: newUser.id,
        name: newUser.name,
        username: newUser.username,
        role:
          (newUser.role as "citizen" | "institution" | "admin") || "citizen",
        avatarUrl: newUser.avatarUrl || undefined,
        institutionType: newUser.institutionType || undefined,
        institutionName: newUser.institutionName || undefined,
        createdAt: newUser.createdAt?.toISOString() || new Date().toISOString(),
      });
    } catch (err) {
      console.error("Failed to index new user in Meilisearch:", err);
    }

    // Create session
    const { token: sessionToken, hash: sessionHash } = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.insert(sessions).values({
      userId: newUser.id,
      tokenHash: sessionHash,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      expiresAt: sessionExpiresAt,
    });

    // Set session cookie
    res.cookie("session", sessionToken, {
      ...getSessionCookieOptions(req),
      expires: sessionExpiresAt,
    });

    res.status(201).json({
      success: true,
      data: {
        id: newUser.id,
        username: newUser.username,
        name: newUser.name,
        inviteCodesRemaining: newUser.inviteCodesRemaining,
      },
    });
  }),
);

// POST /auth/login - Login with username/email and password
router.post(
  "/login",
  asyncHandler(async (req, res: Response) => {
    const { username, password } = loginSchema.parse(req.body);

    // Find user by username or email
    const [user] = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.username, username.toLowerCase()),
          eq(users.email, username.toLowerCase()),
        ),
      )
      .limit(1);

    if (!user || !user.passwordHash) {
      res.status(401).json({ success: false, error: "Invalid credentials" });
      return;
    }

    // Verify password
    const validPassword = await argon2.verify(user.passwordHash, password);

    if (!validPassword) {
      res.status(401).json({ success: false, error: "Invalid credentials" });
      return;
    }

    const activeSanction = await getActiveBlockingSanction(user.id);
    if (activeSanction) {
      res.status(403).json(formatBlockingSanctionResponse(activeSanction));
      return;
    }

    // Create session
    const { token: sessionToken, hash: sessionHash } = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: sessionHash,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      expiresAt: sessionExpiresAt,
    });

    // Set session cookie
    res.cookie("session", sessionToken, {
      ...getSessionCookieOptions(req),
      expires: sessionExpiresAt,
    });

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  }),
);

// GET /auth/verify/:token - Verify magic link and create session
router.get(
  "/verify/:token",
  asyncHandler(async (req, res: Response) => {
    const { token } = verifySchema.parse(req.params);
    const tokenHash = hashToken(token);

    // Find valid magic link
    const [magicLink] = await db
      .select()
      .from(magicLinks)
      .where(
        and(
          eq(magicLinks.tokenHash, tokenHash),
          eq(magicLinks.used, false),
          gt(magicLinks.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!magicLink) {
      res
        .status(400)
        .json({ success: false, error: "Invalid or expired link" });
      return;
    }

    // Mark as used
    await db
      .update(magicLinks)
      .set({ used: true })
      .where(eq(magicLinks.id, magicLink.id));

    // Find or create user
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, magicLink.email))
      .limit(1);

    if (!user) {
      // Create new user with generated username from email
      const baseUsername = magicLink.email
        .split("@")[0]
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .toLowerCase();
      const uniqueSuffix = Date.now().toString(36).slice(-4);
      const [newUser] = await db
        .insert(users)
        .values({
          email: magicLink.email,
          username: `${baseUsername}_${uniqueSuffix}`,
          name: magicLink.email.split("@")[0], // Temporary name
          identityProvider: "magic_link",
          identityVerified: false,
          identityLevel: "basic",
        })
        .returning();

      user = newUser;
    }

    const activeSanction = await getActiveBlockingSanction(user.id);
    if (activeSanction) {
      res.status(403).json(formatBlockingSanctionResponse(activeSanction));
      return;
    }

    // Create session
    const { token: sessionToken, hash: sessionHash } = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: sessionHash,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      expiresAt: sessionExpiresAt,
    });

    // Set session cookie
    res.cookie("session", sessionToken, {
      ...getSessionCookieOptions(req),
      expires: sessionExpiresAt,
    });

    // Redirect to app
    res.redirect(`${env.APP_URL}/auth/callback?success=true`);
  }),
);

// POST /auth/logout - End session
router.post(
  "/logout",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (req.sessionId) {
      await db.delete(sessions).where(eq(sessions.id, req.sessionId));
    }

    res.clearCookie("session", getSessionCookieOptions(req));
    res.json({ success: true });
  }),
);

// GET /auth/me - Get current user
router.get(
  "/me",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;

    // Get municipality if set
    let municipality = null;
    if (user.municipalityId) {
      const { municipalities } = await import("../db/index.js");
      const [muni] = await db
        .select()
        .from(municipalities)
        .where(eq(municipalities.id, user.municipalityId))
        .limit(1);
      municipality = muni;
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        verifiedName: user.verifiedName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        institutionType: user.institutionType,
        institutionName: user.institutionName,
        municipality,
        identityVerified: user.identityVerified,
        identityLevel: user.identityLevel,
        settings: {
          notificationReplies: user.notificationReplies,
          notificationMentions: user.notificationMentions,
          notificationOfficial: user.notificationOfficial,
          locale: user.locale,
        },
        onboardingCompletedAt: user.onboardingCompletedAt,
        createdAt: user.createdAt,
        isManagedAccount: false,
        hasPassword: Boolean(user.passwordHash),
      },
    });
  }),
);

export default router;
