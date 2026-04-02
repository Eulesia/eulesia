/**
 * Search Index Sync Service
 *
 * Syncs data from PostgreSQL to Meilisearch.
 * Run on startup and periodically to keep indexes fresh.
 */

import {
  db,
  users,
  threads,
  threadTags,
  places,
  municipalities,
  locations,
} from "../../db/index.js";
import { sql } from "drizzle-orm";
import { getMinuteSources } from "../import/fetchers/index.js";
import { getAdminLevel, getEntityName } from "../import/fetchers/types.js";
import {
  initializeIndexes,
  indexUsers,
  indexThreads,
  indexPlaces,
  indexMunicipalities,
  indexLocations,
  indexTags,
  healthCheck,
  type UserDocument,
  type ThreadDocument,
  type PlaceDocument,
  type MunicipalityDocument,
  type LocationDocument,
  type TagDocument,
} from "./meilisearch.js";

/**
 * Full sync of all data to Meilisearch
 */
export async function fullSync(): Promise<{
  users: number;
  threads: number;
  places: number;
  municipalities: number;
  locations: number;
  tags: number;
  durationMs: number;
}> {
  const startTime = Date.now();
  console.log("Starting full search index sync...");

  // Check Meilisearch is available
  const isHealthy = await healthCheck();
  if (!isHealthy) {
    throw new Error("Meilisearch is not available");
  }

  // Initialize indexes (idempotent)
  await initializeIndexes();

  // Sync users
  const userDocs = await syncUsers();
  console.log(`  Indexed ${userDocs} users`);

  // Sync threads
  const threadDocs = await syncThreads();
  console.log(`  Indexed ${threadDocs} threads`);

  // Sync places
  const placeDocs = await syncPlaces();
  console.log(`  Indexed ${placeDocs} places`);

  // Ensure all configured municipalities exist in DB
  await ensureConfiguredMunicipalities();

  // Sync municipalities
  const municipalityDocs = await syncMunicipalities();
  console.log(`  Indexed ${municipalityDocs} municipalities`);

  // Sync locations (dynamic locations from Nominatim)
  const locationDocs = await syncLocations();
  console.log(`  Indexed ${locationDocs} locations`);

  // Sync tags
  const tagDocs = await syncTags();
  console.log(`  Indexed ${tagDocs} tags`);

  const durationMs = Date.now() - startTime;
  console.log(`Full sync completed in ${durationMs}ms`);

  return {
    users: userDocs,
    threads: threadDocs,
    places: placeDocs,
    municipalities: municipalityDocs,
    locations: locationDocs,
    tags: tagDocs,
    durationMs,
  };
}

/**
 * Sync all users to Meilisearch
 */
async function syncUsers(): Promise<number> {
  const allUsers = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      avatarUrl: users.avatarUrl,
      institutionType: users.institutionType,
      institutionName: users.institutionName,
      identityProvider: users.identityProvider,
      createdAt: users.createdAt,
    })
    .from(users);

  const docs: UserDocument[] = allUsers
    .filter((u) => u.role !== null) // Skip users with null role
    .filter((u) => u.identityProvider !== "eulesia-bot") // Hide bot-managed institution placeholders
    .map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role as "citizen" | "institution" | "admin",
      avatarUrl: u.avatarUrl || undefined,
      institutionType: u.institutionType || undefined,
      institutionName: u.institutionName || undefined,
      createdAt: u.createdAt?.toISOString() || new Date().toISOString(),
    }));

  await indexUsers(docs);
  return docs.length;
}

/**
 * Sync all threads to Meilisearch
 */
async function syncThreads(): Promise<number> {
  // Get threads with author and municipality
  const allThreads = await db
    .select({
      thread: threads,
      authorName: users.name,
      municipalityName: municipalities.name,
    })
    .from(threads)
    .leftJoin(users, sql`${threads.authorId} = ${users.id}`)
    .leftJoin(
      municipalities,
      sql`${threads.municipalityId} = ${municipalities.id}`,
    );

  // Get tags for all threads
  const allTags = await db.select().from(threadTags);
  const tagsByThread: Record<string, string[]> = {};
  for (const tag of allTags) {
    if (!tagsByThread[tag.threadId]) tagsByThread[tag.threadId] = [];
    tagsByThread[tag.threadId].push(tag.tag);
  }

  const docs: ThreadDocument[] = allThreads.map((t) => ({
    id: t.thread.id,
    title: t.thread.title,
    content: t.thread.content.substring(0, 10000), // Limit content size
    scope: t.thread.scope,
    authorName: t.authorName || "Unknown",
    authorId: t.thread.authorId,
    municipalityName: t.municipalityName || undefined,
    municipalityId: t.thread.municipalityId || undefined,
    tags: tagsByThread[t.thread.id] || [],
    score: t.thread.score || 0,
    replyCount: t.thread.replyCount || 0,
    isHidden: t.thread.isHidden === true,
    createdAt: t.thread.createdAt?.toISOString() || new Date().toISOString(),
    updatedAt: t.thread.updatedAt?.toISOString() || new Date().toISOString(),
  }));

  await indexThreads(docs);
  return docs.length;
}

/**
 * Sync all places to Meilisearch
 */
async function syncPlaces(): Promise<number> {
  const allPlaces = await db
    .select({
      place: places,
      municipalityName: municipalities.name,
    })
    .from(places)
    .leftJoin(
      municipalities,
      sql`${places.municipalityId} = ${municipalities.id}`,
    );

  const docs: PlaceDocument[] = allPlaces.map((p) => ({
    id: p.place.id,
    name: p.place.name,
    description: p.place.description || undefined,
    category: p.place.category || undefined,
    municipalityName: p.municipalityName || undefined,
    municipalityId: p.place.municipalityId || undefined,
    latitude: p.place.latitude ? Number(p.place.latitude) : undefined,
    longitude: p.place.longitude ? Number(p.place.longitude) : undefined,
  }));

  await indexPlaces(docs);
  return docs.length;
}

/**
 * Sync all municipalities to Meilisearch
 */
async function syncMunicipalities(): Promise<number> {
  const allMunicipalities = await db.select().from(municipalities);

  const docs: MunicipalityDocument[] = allMunicipalities.map((m) => ({
    id: m.id,
    name: m.name,
    nameFi: m.nameFi || m.name,
    region: m.region || undefined,
    country: m.country || "FI",
  }));

  await indexMunicipalities(docs);
  return docs.length;
}

/**
 * Sync all locations (dynamic Nominatim locations) to Meilisearch
 */
async function syncLocations(): Promise<number> {
  const allLocations = await db.select().from(locations);

  const docs: LocationDocument[] = allLocations.map((loc) => ({
    id: loc.id,
    osmId: loc.osmId || 0,
    osmType: loc.osmType || "relation",
    name: loc.name,
    nameFi: loc.nameFi || undefined,
    nameSv: loc.nameSv || undefined,
    nameEn: loc.nameEn || undefined,
    displayName: loc.nameLocal || loc.name,
    type: loc.type || "municipality",
    adminLevel: loc.adminLevel || undefined,
    country: loc.country || "FI",
    latitude: loc.latitude ? Number(loc.latitude) : 0,
    longitude: loc.longitude ? Number(loc.longitude) : 0,
    population: loc.population || undefined,
    contentCount: loc.contentCount || 0,
    parentName: undefined, // Could be resolved but adds complexity
  }));

  await indexLocations(docs);
  return docs.length;
}

/**
 * Sync all tags to Meilisearch
 */
async function syncTags(): Promise<number> {
  const tagCounts = await db
    .select({
      tag: threadTags.tag,
      count: sql<number>`count(*)::int`,
    })
    .from(threadTags)
    .groupBy(threadTags.tag);

  const docs: TagDocument[] = tagCounts.map((t) => ({
    tag: t.tag,
    count: t.count,
  }));

  await indexTags(docs);
  return docs.length;
}

/**
 * Ensure all configured municipality-level minute sources exist in the database.
 * This pre-seeds municipalities so they appear in search before any import runs.
 */
async function ensureConfiguredMunicipalities(): Promise<void> {
  const sources = await getMinuteSources();
  const uniqueSources = new Map<string, { name: string; country: string }>();
  let created = 0;

  for (const source of sources) {
    if (getAdminLevel(source) !== "municipality") continue;
    const name = getEntityName(source);
    const country = source.country || "FI";
    uniqueSources.set(`${country}:${name.toLowerCase()}`, { name, country });
  }

  for (const { name, country } of uniqueSources.values()) {
    const normalized =
      name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

    const existing = await db
      .select({ id: municipalities.id })
      .from(municipalities)
      .where(
        sql`${municipalities.name} = ${normalized} AND ${municipalities.country} = ${country}`,
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(municipalities).values({
        name: normalized,
        nameFi: country === "FI" ? normalized : undefined,
        country,
      });
      created++;
    }
  }

  if (created > 0) {
    console.log(`  Pre-seeded ${created} municipalities from import sources`);
  }
}

/**
 * Start periodic sync (run every N minutes)
 */
export function startPeriodicSync(intervalMinutes = 5): NodeJS.Timeout {
  console.log(`Starting periodic search sync every ${intervalMinutes} minutes`);

  return setInterval(
    async () => {
      try {
        await fullSync();
      } catch (error) {
        console.error("Periodic search sync failed:", error);
      }
    },
    intervalMinutes * 60 * 1000,
  );
}
