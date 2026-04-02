import { Router, type Request, type Response } from "express";
import {
  db,
  threads,
  clubs,
  clubThreads,
  municipalities,
  users,
} from "../db/index.js";
import { eq } from "drizzle-orm";

const router = Router();

const SITE_NAME = "Eulesia";
const DEFAULT_DESCRIPTION = "Eurooppalainen kansalaisdemokratia-alusta";
const DEFAULT_IMAGE = "/og-default.png";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripMarkdown(text: string): string {
  return text
    .replace(/[#*_~`>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim()
    .substring(0, 200);
}

function buildOgHtml(opts: {
  title: string;
  description: string;
  url: string;
  type?: string;
  image?: string;
  siteName?: string;
}): string {
  const {
    title,
    description,
    url,
    type = "article",
    image,
    siteName = SITE_NAME,
  } = opts;

  const appUrl = process.env.APP_URL || "https://eulesia.org";
  const fullUrl = url.startsWith("http") ? url : `${appUrl}${url}`;
  const imageUrl = image
    ? image.startsWith("http")
      ? image
      : `${process.env.API_URL || appUrl}${image}`
    : `${appUrl}${DEFAULT_IMAGE}`;

  return `<!DOCTYPE html>
<html lang="fi">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)} - ${escapeHtml(siteName)}</title>
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(fullUrl)}" />
  <meta property="og:type" content="${escapeHtml(type)}" />
  <meta property="og:site_name" content="${escapeHtml(siteName)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  <meta name="description" content="${escapeHtml(description)}" />
  <meta http-equiv="refresh" content="0;url=${escapeHtml(fullUrl)}" />
</head>
<body></body>
</html>`;
}

function defaultOg(req: Request, res: Response) {
  res.status(200).send(
    buildOgHtml({
      title: SITE_NAME,
      description: DEFAULT_DESCRIPTION,
      url: req.originalUrl,
    }),
  );
}

// Thread OG
router.get("/agora/thread/:threadId", async (req: Request, res: Response) => {
  try {
    const [thread] = await db
      .select({
        title: threads.title,
        content: threads.content,
        scope: threads.scope,
      })
      .from(threads)
      .where(eq(threads.id, req.params.threadId))
      .limit(1);

    if (!thread) return defaultOg(req, res);

    res.send(
      buildOgHtml({
        title: thread.title,
        description: stripMarkdown(thread.content),
        url: req.originalUrl,
        type: "article",
      }),
    );
  } catch {
    defaultOg(req, res);
  }
});

// Club OG
router.get("/clubs/:clubId", async (req: Request, res: Response) => {
  try {
    const [club] = await db
      .select({
        name: clubs.name,
        description: clubs.description,
        coverImageUrl: clubs.coverImageUrl,
        memberCount: clubs.memberCount,
      })
      .from(clubs)
      .where(eq(clubs.id, req.params.clubId))
      .limit(1);

    if (!club) return defaultOg(req, res);

    const desc = club.description
      ? stripMarkdown(club.description)
      : `${club.memberCount || 0} jäsentä`;

    res.send(
      buildOgHtml({
        title: club.name,
        description: desc,
        url: req.originalUrl,
        type: "website",
        image: club.coverImageUrl || undefined,
      }),
    );
  } catch {
    defaultOg(req, res);
  }
});

// Club thread OG
router.get(
  "/clubs/:clubId/thread/:threadId",
  async (req: Request, res: Response) => {
    try {
      const [thread] = await db
        .select({
          title: clubThreads.title,
          content: clubThreads.content,
        })
        .from(clubThreads)
        .where(eq(clubThreads.id, req.params.threadId))
        .limit(1);

      if (!thread) return defaultOg(req, res);

      res.send(
        buildOgHtml({
          title: thread.title,
          description: stripMarkdown(thread.content),
          url: req.originalUrl,
          type: "article",
        }),
      );
    } catch {
      defaultOg(req, res);
    }
  },
);

// Municipality OG
router.get("/kunnat/:municipalityId", async (req: Request, res: Response) => {
  try {
    const [municipality] = await db
      .select({
        name: municipalities.name,
        nameFi: municipalities.nameFi,
      })
      .from(municipalities)
      .where(eq(municipalities.id, req.params.municipalityId))
      .limit(1);

    if (!municipality) return defaultOg(req, res);

    const name = municipality.nameFi || municipality.name;
    res.send(
      buildOgHtml({
        title: name,
        description: `${name} - keskustelu ja päätöksenteko`,
        url: req.originalUrl,
        type: "place",
      }),
    );
  } catch {
    defaultOg(req, res);
  }
});

// Agora feed OG
router.get("/agora", (_req: Request, res: Response) => {
  res.send(
    buildOgHtml({
      title: "Agora – Kansalaiskeskustelu",
      description:
        "Osallistu kansalaiskeskusteluun Eulesia-alustalla. Keskustele paikallisista, kansallisista ja eurooppalaisista aiheista.",
      url: "/agora",
      type: "website",
    }),
  );
});

// Tag page OG
router.get("/agora/tag/:tagName", (req: Request, res: Response) => {
  const tagName = decodeURIComponent(req.params.tagName).replace(/-/g, " ");
  res.send(
    buildOgHtml({
      title: `${tagName} – Agora`,
      description: `Keskustelut aiheesta ${tagName} Eulesia-alustalla`,
      url: req.originalUrl,
      type: "website",
    }),
  );
});

// Topics page OG
router.get("/aiheet", (_req: Request, res: Response) => {
  res.send(
    buildOgHtml({
      title: "Aiheet",
      description:
        "Selaa keskusteluaiheita Eulesia-alustalla. Talous, terveys, koulutus, ympäristö ja monta muuta aihealuetta.",
      url: "/aiheet",
      type: "website",
    }),
  );
});

// Municipalities list OG
router.get("/kunnat", (_req: Request, res: Response) => {
  res.send(
    buildOgHtml({
      title: "Kunnat",
      description:
        "Selaa kuntien keskusteluja Eulesia-alustalla. Osallistu paikalliseen päätöksentekoon.",
      url: "/kunnat",
      type: "website",
    }),
  );
});

// User profile OG
router.get("/user/:userId", async (req: Request, res: Response) => {
  try {
    const [user] = await db
      .select({
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, req.params.userId))
      .limit(1);

    if (!user) {
      return defaultOg(req, res);
    }

    res.send(
      buildOgHtml({
        title: user.name,
        description: `${user.name} Eulesia-alustalla`,
        url: req.originalUrl,
        type: "profile",
        image: user.avatarUrl || undefined,
      }),
    );
  } catch {
    defaultOg(req, res);
  }
});

export default router;
