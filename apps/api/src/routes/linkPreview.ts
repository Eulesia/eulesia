import { Router, type Request, type Response } from "express";
import { db, linkPreviews } from "../db/index.js";
import { eq } from "drizzle-orm";
import {
  assertExternalHttpUrl,
  UrlValidationError,
} from "../utils/urlSecurity.js";

const router = Router();

// Cache TTL: 7 days
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REDIRECTS = 5;
const REQUEST_HEADERS = {
  "User-Agent": "EulesiaBot/1.0 (+https://eulesia.org)",
  Accept: "text/html,application/xhtml+xml",
};

async function fetchWithValidatedRedirects(
  urlString: string,
  signal: AbortSignal,
): Promise<{ response: globalThis.Response; finalUrl: URL }> {
  let currentUrl = urlString;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const parsedUrl = await assertExternalHttpUrl(currentUrl);
    const response = await fetch(parsedUrl, {
      signal,
      redirect: "manual",
      headers: REQUEST_HEADERS,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();

      if (!location) {
        throw new Error("Redirect missing location");
      }

      if (redirectCount === MAX_REDIRECTS) {
        throw new Error("Too many redirects");
      }

      currentUrl = new URL(location, parsedUrl).toString();
      continue;
    }

    return { response, finalUrl: parsedUrl };
  }

  throw new Error("Too many redirects");
}

// Parse OG metadata from HTML
function parseOgMetadata(html: string, baseUrl: string) {
  const getMetaContent = (property: string): string | null => {
    // Match both property="og:..." and name="..." patterns
    const patterns = [
      new RegExp(
        `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
        "i",
      ),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return decodeHtmlEntities(match[1]);
    }
    return null;
  };

  const getNameContent = (name: string): string | null => {
    const patterns = [
      new RegExp(
        `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`,
        "i",
      ),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return decodeHtmlEntities(match[1]);
    }
    return null;
  };

  // Extract title
  let title = getMetaContent("og:title");
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : null;
  }

  // Extract description
  let description = getMetaContent("og:description");
  if (!description) {
    description = getNameContent("description");
  }
  // Truncate description
  if (description && description.length > 300) {
    description = description.substring(0, 297) + "...";
  }

  // Extract image
  let imageUrl = getMetaContent("og:image");
  if (imageUrl && !imageUrl.startsWith("http")) {
    try {
      imageUrl = new URL(imageUrl, baseUrl).href;
    } catch {
      imageUrl = null;
    }
  }

  // Extract site name
  const siteName = getMetaContent("og:site_name");

  // Extract favicon
  let faviconUrl: string | null = null;
  const faviconMatch =
    html.match(
      /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
    ) ||
    html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i,
    );
  if (faviconMatch) {
    faviconUrl = faviconMatch[1];
    if (!faviconUrl.startsWith("http")) {
      try {
        faviconUrl = new URL(faviconUrl, baseUrl).href;
      } catch {
        faviconUrl = null;
      }
    }
  }
  if (!faviconUrl) {
    try {
      faviconUrl = new URL("/favicon.ico", baseUrl).href;
    } catch {
      // ignore
    }
  }

  return { title, description, imageUrl, siteName, faviconUrl };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

// GET /link-preview?url=...
router.get("/link-preview", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      return res.status(400).json({ success: false, error: "URL required" });
    }

    try {
      await assertExternalHttpUrl(url);
    } catch (error) {
      if (error instanceof UrlValidationError) {
        const validationError =
          error.code === "invalid_url"
            ? "Invalid URL"
            : error.code === "unsupported_protocol"
              ? "Only HTTP/HTTPS URLs supported"
              : "Internal URLs not allowed";

        return res.status(400).json({ success: false, error: validationError });
      }
      throw error;
    }

    // Check cache
    const [cached] = await db
      .select()
      .from(linkPreviews)
      .where(eq(linkPreviews.url, url))
      .limit(1);

    if (cached) {
      const age = Date.now() - cached.fetchedAt.getTime();
      if (age < CACHE_TTL_MS) {
        if (cached.error) {
          return res
            .status(404)
            .json({ success: false, error: "Preview not available" });
        }
        return res.json({
          success: true,
          data: {
            url: cached.url,
            title: cached.title,
            description: cached.description,
            imageUrl: cached.imageUrl,
            siteName: cached.siteName,
            faviconUrl: cached.faviconUrl,
          },
        });
      }
    }

    // Fetch the URL
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let response: globalThis.Response;
    let finalUrl: URL;
    try {
      ({ response, finalUrl } = await fetchWithValidatedRedirects(
        url,
        controller.signal,
      ));
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof UrlValidationError) {
        return res
          .status(400)
          .json({ success: false, error: "Internal URLs not allowed" });
      }
      // Cache the error
      await upsertPreview(url, { error: true });
      return res
        .status(404)
        .json({ success: false, error: "Failed to fetch URL" });
    }
    clearTimeout(timeout);

    // Verify content type
    const contentType = response.headers.get("content-type") || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      await upsertPreview(url, { error: true });
      return res
        .status(404)
        .json({ success: false, error: "Not an HTML page" });
    }

    // Read body (max 1MB)
    const reader = response.body?.getReader();
    if (!reader) {
      await upsertPreview(url, { error: true });
      return res
        .status(404)
        .json({ success: false, error: "No response body" });
    }

    let html = "";
    const decoder = new TextDecoder();
    const MAX_SIZE = 1024 * 1024; // 1MB
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.length;
      if (totalSize > MAX_SIZE) break;
      html += decoder.decode(value, { stream: true });
      // Stop early if we've found </head> — metadata is in <head>
      if (html.includes("</head>")) break;
    }
    reader.cancel();

    // Parse metadata
    const baseUrl = `${finalUrl.protocol}//${finalUrl.host}`;
    const metadata = parseOgMetadata(html, baseUrl);

    if (!metadata.title) {
      await upsertPreview(url, { error: true });
      return res
        .status(404)
        .json({ success: false, error: "No metadata found" });
    }

    // Cache
    await upsertPreview(url, {
      title: metadata.title,
      description: metadata.description,
      imageUrl: metadata.imageUrl,
      siteName: metadata.siteName,
      faviconUrl: metadata.faviconUrl,
      error: false,
    });

    return res.json({
      success: true,
      data: {
        url,
        title: metadata.title,
        description: metadata.description,
        imageUrl: metadata.imageUrl,
        siteName: metadata.siteName,
        faviconUrl: metadata.faviconUrl,
      },
    });
  } catch {
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

async function upsertPreview(
  url: string,
  data: {
    title?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    siteName?: string | null;
    faviconUrl?: string | null;
    error?: boolean;
  },
) {
  await db
    .insert(linkPreviews)
    .values({
      url,
      title: data.title ?? null,
      description: data.description ?? null,
      imageUrl: data.imageUrl ?? null,
      siteName: data.siteName ?? null,
      faviconUrl: data.faviconUrl ?? null,
      error: data.error ?? false,
    })
    .onConflictDoUpdate({
      target: linkPreviews.url,
      set: {
        title: data.title ?? null,
        description: data.description ?? null,
        imageUrl: data.imageUrl ?? null,
        siteName: data.siteName ?? null,
        faviconUrl: data.faviconUrl ?? null,
        error: data.error ?? false,
        fetchedAt: new Date(),
      },
    });
}

export default router;
