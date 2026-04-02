import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";

import { env } from "./utils/env.js";
import routes from "./routes/index.js";
import ogRoutes from "./routes/og.js";
import sitemapRoutes from "./routes/sitemap.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { initScheduler } from "./services/scheduler.js";
import { initWebPush } from "./services/pushNotifications.js";
import { initFCM } from "./services/fcmNotifications.js";
import { setNotifyIO } from "./services/notify.js";
import {
  fullSync,
  startPeriodicSync,
  healthCheck as meiliHealthCheck,
} from "./services/search/index.js";
import { hashToken } from "./utils/crypto.js";
import { getActiveBlockingSanction } from "./utils/sanctions.js";
import { runStartupMigrations } from "./db/startupMigrations.js";

// Upload directory (relative to project root)
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

// Build allowed origins list (web + Capacitor native apps)
const allowedOrigins = [env.APP_URL];
if (env.ALLOWED_ORIGINS) {
  allowedOrigins.push(...env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()));
}

const app = express();
const httpServer = createServer(app);

// Socket.io setup
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", ...allowedOrigins],
      },
    },
  }),
);

// CORS
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Trust proxy (for rate limiting behind reverse proxy) — MUST be before rate limiter
app.set("trust proxy", 1);

// Rate limiting (relaxed in development)
const isDev = env.NODE_ENV === "development";

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isDev ? 1000 : 100, // 1000 in dev, 100 in prod
  message: {
    success: false,
    error: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev, // Skip rate limiting entirely in development
});

// Auth rate limiter: 20 attempts per 15 min window per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 10,
  message: {
    success: false,
    error: "Too many authentication attempts, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
});

const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 1000 : 5,
  message: {
    success: false,
    error: "Too many waitlist submissions, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
});

app.use(limiter);
app.post("/api/v1/auth/login", authLimiter);
app.post("/api/v1/auth/register", authLimiter);
app.post("/api/v1/auth/magic-link", authLimiter);
app.get("/api/v1/auth/ftn/start", authLimiter);
app.use("/api/v1/waitlist/join", waitlistLimiter);

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve uploaded files with CORS headers
app.use(
  "/uploads",
  (_req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  },
  express.static(path.resolve(UPLOAD_DIR)),
);

// Deep linking: Apple Universal Links
app.get("/.well-known/apple-app-site-association", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json({
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [`${process.env.APPLE_TEAM_ID || "TEAM_ID"}.eu.eulesia.app`],
          components: [{ "/": "/api/v1/auth/verify/*" }],
        },
      ],
    },
  });
});

// Deep linking: Android App Links
app.get("/.well-known/assetlinks.json", (_req, res) => {
  res.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "eu.eulesia.app",
        sha256_cert_fingerprints: [process.env.ANDROID_CERT_FINGERPRINT || ""],
      },
    },
  ]);
});

// Health check endpoint
app.get("/health", async (_req, res) => {
  const meiliOk = await meiliHealthCheck();
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      meilisearch: meiliOk ? "ok" : "unavailable",
    },
  });
});

// OG meta tag routes (bot detection via Traefik)
app.use(ogRoutes);

// Dynamic sitemap (routed via Traefik for /sitemap.xml)
app.use(sitemapRoutes);

// API routes
app.use("/api/v1", routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Socket.io authentication middleware
io.use(async (socket, next) => {
  try {
    const rawCookies = socket.handshake.headers.cookie;
    if (!rawCookies) {
      return next(new Error("Authentication required"));
    }

    // Parse cookies manually (simple key=value pairs separated by '; ')
    const cookieMap = Object.fromEntries(
      rawCookies.split("; ").map((c) => {
        const [k, ...v] = c.split("=");
        return [k, v.join("=")];
      }),
    );
    const sessionToken = cookieMap.session;
    if (!sessionToken) {
      return next(new Error("Authentication required"));
    }

    const tokenHash = hashToken(sessionToken);
    const { eq, and, gt } = await import("drizzle-orm");
    const { db, sessions, users } = await import("./db/index.js");

    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      return next(new Error("Invalid session"));
    }

    const [user] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      return next(new Error("User not found"));
    }

    const activeSanction = await getActiveBlockingSanction(user.id);
    if (activeSanction) {
      return next(
        new Error(
          activeSanction.sanctionType === "ban"
            ? "Account banned"
            : "Account suspended",
        ),
      );
    }

    // Attach userId to socket for later use
    (socket as any).userId = user.id;
    (socket as any).userRole = user.role;
    next();
  } catch (err) {
    console.error("Socket auth error:", err);
    next(new Error("Authentication failed"));
  }
});

// Socket.io events (authenticated connections only)
io.on("connection", (socket) => {
  const userId = (socket as any).userId as string;
  console.log("Socket connected:", socket.id, "user:", userId);

  // Agora threads — public, allow all authenticated users
  socket.on("join:thread", (threadId: string) => {
    socket.join(`thread:${threadId}`);
  });

  socket.on("leave:thread", (threadId: string) => {
    socket.leave(`thread:${threadId}`);
  });

  // User-specific room (notifications) — only own room
  socket.on("join:user", (requestedUserId: string) => {
    if (requestedUserId === userId) {
      socket.join(`user:${userId}`);
    }
  });

  socket.on("leave:user", (requestedUserId: string) => {
    if (requestedUserId === userId) {
      socket.leave(`user:${userId}`);
    }
  });

  // Direct messages — verify participation
  socket.on("join:dm", async (conversationId: string) => {
    try {
      const { eq, and } = await import("drizzle-orm");
      const { db, conversationParticipants } = await import("./db/index.js");
      const [participant] = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId),
          ),
        )
        .limit(1);
      if (participant || (socket as any).userRole === "admin") {
        socket.join(`dm:${conversationId}`);
      }
    } catch (err) {
      console.error("Error joining DM:", err);
    }
  });

  socket.on("leave:dm", (conversationId: string) => {
    socket.leave(`dm:${conversationId}`);
  });

  // Typing indicators — broadcast to others in the same dm
  socket.on("typing:dm", (conversationId: string) => {
    socket
      .to(`dm:${conversationId}`)
      .emit("user_typing_dm", { conversationId, userId });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// Export io for use in routes
export { io };

// Initialize services
initWebPush();
initFCM();
setNotifyIO(io);

// Run pending migrations before starting
runStartupMigrations()
  .then(() => {
    console.log("Migrations OK");
  })
  .catch((error: unknown) => {
    console.error("Migration error:", error);
  });

// Start server
const PORT = parseInt(env.PORT);
httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🏛️  EULESIA API SERVER                                  ║
║                                                           ║
║   European Civic Digital Infrastructure                   ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   Environment: ${env.NODE_ENV.padEnd(40)}║
║   Port:        ${PORT.toString().padEnd(40)}║
║   API URL:     ${env.API_URL.padEnd(40)}║
║   App URL:     ${env.APP_URL.padEnd(40)}║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Initialize background scheduler
  initScheduler();

  // Initialize search index (async, don't block startup)
  setTimeout(async () => {
    try {
      console.log("Initializing search indexes...");
      await fullSync();
      startPeriodicSync(5); // Sync every 5 minutes
      console.log("Search indexes ready");
    } catch (error) {
      console.error("Failed to initialize search:", error);
      // Continue running - search is optional
    }
  }, 2000); // Wait 2s for Meilisearch to be ready
});
