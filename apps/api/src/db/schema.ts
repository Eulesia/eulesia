import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  inet,
  index,
  uniqueIndex,
  pgEnum,
  decimal,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const userRoleEnum = pgEnum("user_role", [
  "citizen",
  "institution",
  "admin",
]);
export const institutionTypeEnum = pgEnum("institution_type", [
  "municipality",
  "agency",
  "ministry",
  "organization",
]);
export const identityLevelEnum = pgEnum("identity_level", [
  "basic",
  "substantial",
  "high",
]);
export const scopeEnum = pgEnum("scope", ["local", "national", "european"]);
export const clubMemberRoleEnum = pgEnum("club_member_role", [
  "member",
  "moderator",
  "admin",
]);
export const roomVisibilityEnum = pgEnum("room_visibility", [
  "public",
  "private",
]);
export const placeTypeEnum = pgEnum("place_type", [
  "poi",
  "area",
  "route",
  "landmark",
  "building",
]);
export const placeSourceEnum = pgEnum("place_source", [
  "user",
  "osm",
  "lipas",
  "mml",
  "municipal",
]);
export const syncStatusEnum = pgEnum("sync_status", [
  "active",
  "deprecated",
  "merged",
]);
export const inviteCodeStatusEnum = pgEnum("invite_code_status", [
  "available",
  "used",
  "revoked",
]);
export const threadSourceEnum = pgEnum("thread_source", [
  "user",
  "minutes_import",
  "rss_import",
]);
export const locationTypeEnum = pgEnum("location_type", [
  "country",
  "region",
  "municipality",
  "village",
  "district",
]);
export const subscriptionNotifyEnum = pgEnum("subscription_notify", [
  "all",
  "none",
  "highlights",
]);
export const institutionManagerRoleEnum = pgEnum("institution_manager_role", [
  "owner",
  "editor",
]);
export const institutionClaimStatusEnum = pgEnum("institution_claim_status", [
  "pending",
  "approved",
  "rejected",
]);
export const waitlistStatusEnum = pgEnum("waitlist_status", [
  "pending",
  "approved",
  "rejected",
]);

// Moderation enums (DSA)
export const reportReasonEnum = pgEnum("report_reason", [
  "illegal",
  "harassment",
  "spam",
  "misinformation",
  "other",
]);
export const reportStatusEnum = pgEnum("report_status", [
  "pending",
  "reviewing",
  "resolved",
  "dismissed",
]);
export const contentTypeEnum = pgEnum("content_type", [
  "thread",
  "comment",
  "club_thread",
  "club_comment",
  "club",
  "user",
  "room_message",
  "dm",
  "system",
]);
export const actionTypeEnum = pgEnum("action_type", [
  "content_removed",
  "content_restored",
  "user_warned",
  "user_suspended",
  "user_banned",
  "user_unbanned",
  "report_dismissed",
  "report_resolved",
  "role_changed",
  "user_verified",
  "user_unverified",
  "settings_changed",
  "invite_count_changed",
]);
export const sanctionTypeEnum = pgEnum("sanction_type", [
  "warning",
  "suspension",
  "ban",
]);
export const appealStatusEnum = pgEnum("appeal_status", [
  "pending",
  "accepted",
  "rejected",
]);

// Locations (hierarchical administrative areas from OSM)
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    osmId: integer("osm_id").unique(),
    osmType: varchar("osm_type", { length: 20 }).default("relation"), // 'node', 'way', 'relation'
    name: varchar("name", { length: 255 }).notNull(),
    nameLocal: varchar("name_local", { length: 255 }),
    nameFi: varchar("name_fi", { length: 255 }),
    nameSv: varchar("name_sv", { length: 255 }),
    nameEn: varchar("name_en", { length: 255 }),
    adminLevel: integer("admin_level"), // OSM admin_level: 2=country, 4=region, 7=municipality, 8=village
    type: varchar("type", { length: 50 }), // 'country', 'region', 'municipality', 'village', 'district'
    parentId: uuid("parent_id"),
    country: varchar("country", { length: 2 }).default("FI"),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    bounds: jsonb("bounds"), // GeoJSON bounding box
    population: integer("population"),
    status: varchar("status", { length: 20 }).default("active"), // 'active' = has content, 'cached' = no content
    contentCount: integer("content_count").default(0),
    nominatimUpdatedAt: timestamp("nominatim_updated_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    parentIdx: index("locations_parent_idx").on(table.parentId),
    adminLevelIdx: index("locations_admin_level_idx").on(table.adminLevel),
    osmIdx: index("locations_osm_idx").on(table.osmId),
    countryIdx: index("locations_country_idx").on(table.country),
    coordsIdx: index("locations_coords_idx").on(
      table.latitude,
      table.longitude,
    ),
    statusIdx: index("locations_status_idx").on(table.status),
    contentCountIdx: index("locations_content_count_idx").on(
      table.contentCount,
    ),
  }),
);

// Municipalities
export const municipalities = pgTable(
  "municipalities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    nameFi: varchar("name_fi", { length: 255 }),
    nameSv: varchar("name_sv", { length: 255 }),
    region: varchar("region", { length: 255 }),
    country: varchar("country", { length: 2 }).default("FI"),
    population: integer("population"),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    bounds: jsonb("bounds"), // Bounding box or GeoJSON bounds
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    coordsIdx: index("municipalities_coords_idx").on(
      table.latitude,
      table.longitude,
    ),
  }),
);

// Places
export const places = pgTable(
  "places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    nameFi: varchar("name_fi", { length: 255 }),
    nameSv: varchar("name_sv", { length: 255 }),
    nameEn: varchar("name_en", { length: 255 }),
    description: text("description"),

    // Location
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    radiusKm: decimal("radius_km", { precision: 8, scale: 2 }), // Area radius (e.g., park 0.5km)
    geojson: jsonb("geojson"), // Complex shapes (borders, routes)

    // Type & Category
    type: placeTypeEnum("type").notNull(),
    category: varchar("category", { length: 100 }), // civic.library, recreation.park, etc.
    subcategory: varchar("subcategory", { length: 100 }),

    // Link to administrative structure
    municipalityId: uuid("municipality_id").references(() => municipalities.id),
    locationId: uuid("location_id").references(() => locations.id),
    country: varchar("country", { length: 2 }).default("FI"),

    // Address info
    address: varchar("address", { length: 500 }),
    postalCode: varchar("postal_code", { length: 20 }),
    city: varchar("city", { length: 255 }),

    // Contact info
    phone: varchar("phone", { length: 50 }),
    email: varchar("email", { length: 255 }),
    website: varchar("website", { length: 500 }),
    openingHours: jsonb("opening_hours"),

    // Data source tracking
    source: placeSourceEnum("source").default("user"),
    sourceId: varchar("source_id", { length: 255 }), // Original ID from source
    sourceUrl: varchar("source_url", { length: 500 }), // Link back to source
    osmId: varchar("osm_id", { length: 50 }), // OpenStreetMap ID (node/way/relation)
    lastSynced: timestamp("last_synced", { withTimezone: true }),
    syncStatus: syncStatusEnum("sync_status").default("active"),
    metadata: jsonb("metadata").default({}), // Source-specific extra data

    // Meta
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    coordsIdx: index("places_coords_idx").on(table.latitude, table.longitude),
    typeIdx: index("places_type_idx").on(table.type),
    categoryIdx: index("places_category_idx").on(table.category),
    municipalityIdx: index("places_municipality_idx").on(table.municipalityId),
    locationIdx: index("places_location_idx").on(table.locationId),
    sourceIdx: index("places_source_idx").on(table.source, table.sourceId),
    osmIdx: index("places_osm_idx").on(table.osmId),
    countryIdx: index("places_country_idx").on(table.country),
  }),
);

// Users
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).unique(),
    username: varchar("username", { length: 50 }).unique().notNull(),
    passwordHash: varchar("password_hash", { length: 255 }),
    name: varchar("name", { length: 255 }).notNull(),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    role: userRoleEnum("role").default("citizen"),
    institutionType: institutionTypeEnum("institution_type"),
    institutionName: varchar("institution_name", { length: 255 }),
    businessId: varchar("business_id", { length: 50 }), // Y-tunnus (FI), org.nr (SE), etc.
    businessIdCountry: varchar("business_id_country", { length: 2 }), // ISO country code
    websiteUrl: varchar("website_url", { length: 500 }),
    description: text("description"),
    municipalityId: uuid("municipality_id").references(() => municipalities.id),

    // Invite system
    invitedBy: uuid("invited_by"), // Self-reference, can't use .references() here
    inviteCodesRemaining: integer("invite_codes_remaining").default(5),

    // Identity verification
    identityVerified: boolean("identity_verified").default(false),
    identityProvider: varchar("identity_provider", { length: 50 }),
    identityLevel: identityLevelEnum("identity_level").default("basic"),

    // Strong authentication / EUDI Wallet fields
    verifiedName: varchar("verified_name", { length: 255 }), // Official name from PID / strong auth
    rpSubject: varchar("rp_subject", { length: 255 }), // Relying Party subject — persistent pseudonym from wallet/IdP
    identityIssuer: varchar("identity_issuer", { length: 255 }), // Issuer of the identity credential
    identityVerifiedAt: timestamp("identity_verified_at", {
      withTimezone: true,
    }), // When identity was verified

    // Settings
    notificationReplies: boolean("notification_replies").default(true),
    notificationMentions: boolean("notification_mentions").default(true),
    notificationOfficial: boolean("notification_official").default(true),
    locale: varchar("locale", { length: 10 }).default("en"),

    // Onboarding
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
    usernameIdx: index("users_username_idx").on(table.username),
    rpSubjectIdx: uniqueIndex("users_rp_subject_idx").on(table.rpSubject),
    municipalityIdx: index("users_municipality_idx").on(table.municipalityId),
    invitedByIdx: index("users_invited_by_idx").on(table.invitedBy),
  }),
);

// Sessions
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdx: index("sessions_user_idx").on(table.userId),
    tokenIdx: index("sessions_token_idx").on(table.tokenHash),
  }),
);

// Admin Accounts (separate from users — operator identities managed via SOPS)
export const adminAccounts = pgTable(
  "admin_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 50 }).unique().notNull(),
    email: varchar("email", { length: 255 }).unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    managedBy: varchar("managed_by", { length: 50 }).notNull(),
    managedKey: varchar("managed_key", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => ({
    managedKeyUniqueIdx: uniqueIndex(
      "admin_accounts_managed_key_unique_idx",
    ).on(table.managedBy, table.managedKey),
  }),
);

// Admin Sessions (separate from citizen sessions)
export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminAccounts.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    adminIdx: index("admin_sessions_admin_idx").on(table.adminId),
    tokenIdx: index("admin_sessions_token_idx").on(table.tokenHash),
  }),
);

// Magic Links
export const magicLinks = pgTable(
  "magic_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    used: boolean("used").default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tokenIdx: index("magic_links_token_idx").on(table.tokenHash),
  }),
);

// Invite Codes
export const inviteCodes = pgTable(
  "invite_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 20 }).unique().notNull(), // e.g., EULESIA-A7X9K2
    createdBy: uuid("created_by"), // references admin_accounts or users (FK dropped for cross-table audit)
    usedBy: uuid("used_by").references(() => users.id),
    status: inviteCodeStatusEnum("status").default("available"),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // optional expiration
  },
  (table) => ({
    codeIdx: index("invite_codes_code_idx").on(table.code),
    createdByIdx: index("invite_codes_created_by_idx").on(table.createdBy),
    statusIdx: index("invite_codes_status_idx").on(table.status),
  }),
);

// Waitlist
export const waitlist = pgTable(
  "waitlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    status: waitlistStatusEnum("status").default("pending"),
    locale: varchar("locale", { length: 10 }).default("en"),
    ipAddress: inet("ip_address"),
    inviteCodeId: uuid("invite_code_id").references(() => inviteCodes.id),
    approvedBy: uuid("approved_by"), // references admin_accounts (FK dropped for cross-table audit)
    rejectedBy: uuid("rejected_by"), // references admin_accounts (FK dropped for cross-table audit)
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex("waitlist_email_idx").on(table.email),
    statusIdx: index("waitlist_status_idx").on(table.status),
    createdIdx: index("waitlist_created_idx").on(table.createdAt),
  }),
);

// Threads (Agora)
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content").notNull(),
    contentHtml: text("content_html"),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    scope: scopeEnum("scope").notNull(),
    country: varchar("country", { length: 2 }).default("FI"),
    municipalityId: uuid("municipality_id").references(() => municipalities.id),
    institutionalContext: jsonb("institutional_context"),
    isPinned: boolean("is_pinned").default(false),
    isLocked: boolean("is_locked").default(false),
    replyCount: integer("reply_count").default(0),
    score: integer("score").default(0), // Cached vote score (upvotes - downvotes)
    viewCount: integer("view_count").default(0), // Cached unique view count
    // Location fields
    locationId: uuid("location_id").references(() => locations.id),
    placeId: uuid("place_id").references(() => places.id),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    // AI/Import source tracking
    source: threadSourceEnum("source").default("user"),
    sourceUrl: varchar("source_url", { length: 1000 }), // Link to original document
    sourceId: varchar("source_id", { length: 255 }), // External ID (meeting ID, etc.)
    sourceInstitutionId: uuid("source_institution_id").references(
      () => users.id,
    ), // Links bot-imported thread to source institution
    aiGenerated: boolean("ai_generated").default(false),
    aiModel: varchar("ai_model", { length: 100 }), // e.g., 'mistral-large-latest'
    originalContent: text("original_content"), // Original pöytäkirja text before AI summary
    editedBy: uuid("edited_by").references(() => users.id), // If human edited AI content
    editedAt: timestamp("edited_at", { withTimezone: true }),
    isHidden: boolean("is_hidden").default(false),
    language: varchar("language", { length: 10 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    scopeIdx: index("threads_scope_idx").on(table.scope),
    municipalityIdx: index("threads_municipality_idx").on(table.municipalityId),
    authorIdx: index("threads_author_idx").on(table.authorId),
    createdIdx: index("threads_created_idx").on(table.createdAt),
    updatedIdx: index("threads_updated_idx").on(table.updatedAt),
    scoreIdx: index("threads_score_idx").on(table.score),
    locationIdx: index("threads_location_idx").on(table.locationId),
    placeIdx: index("threads_place_idx").on(table.placeId),
    coordsIdx: index("threads_coords_idx").on(table.latitude, table.longitude),
    sourceIdx: index("threads_source_idx").on(table.source),
    sourceIdIdx: index("threads_source_id_idx").on(table.sourceId),
    sourceInstitutionIdx: index("threads_source_institution_idx").on(
      table.sourceInstitutionId,
    ),
    languageIdx: index("threads_language_idx").on(table.language),
  }),
);

// Thread Tags
export const threadTags = pgTable(
  "thread_tags",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    tag: varchar("tag", { length: 100 }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.tag] }),
  }),
);

// Comments
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    contentHtml: text("content_html"),
    depth: integer("depth").default(0), // Nesting depth for display
    score: integer("score").default(0), // Cached vote score
    isHidden: boolean("is_hidden").default(false),
    editedBy: uuid("edited_by").references(() => users.id),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    language: varchar("language", { length: 10 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    threadIdx: index("comments_thread_idx").on(table.threadId),
    parentIdx: index("comments_parent_idx").on(table.parentId),
    scoreIdx: index("comments_score_idx").on(table.score),
  }),
);

// Comment Votes
export const commentVotes = pgTable(
  "comment_votes",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: integer("value").notNull(), // 1 = upvote, -1 = downvote
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.commentId, table.userId] }),
    commentIdx: index("comment_votes_comment_idx").on(table.commentId),
  }),
);

// Thread Votes
export const threadVotes = pgTable(
  "thread_votes",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: integer("value").notNull(), // 1 = upvote, -1 = downvote
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.userId] }),
    threadIdx: index("thread_votes_thread_idx").on(table.threadId),
  }),
);

// Clubs
export const clubs = pgTable(
  "clubs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).unique().notNull(),
    description: text("description"),
    rules: text("rules").array(),
    category: varchar("category", { length: 100 }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id),
    memberCount: integer("member_count").default(1),
    coverImageUrl: varchar("cover_image_url", { length: 500 }),
    isPublic: boolean("is_public").default(true),
    // Location fields
    placeId: uuid("place_id").references(() => places.id),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    address: varchar("address", { length: 500 }),
    municipalityId: uuid("municipality_id").references(() => municipalities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    slugIdx: index("clubs_slug_idx").on(table.slug),
    categoryIdx: index("clubs_category_idx").on(table.category),
    placeIdx: index("clubs_place_idx").on(table.placeId),
    coordsIdx: index("clubs_coords_idx").on(table.latitude, table.longitude),
    municipalityIdx: index("clubs_municipality_idx").on(table.municipalityId),
  }),
);

// Club Members
export const clubMembers = pgTable(
  "club_members",
  {
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: clubMemberRoleEnum("role").default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.clubId, table.userId] }),
    userIdx: index("club_members_user_idx").on(table.userId),
  }),
);

// Club Threads
export const clubThreads = pgTable(
  "club_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content").notNull(),
    contentHtml: text("content_html"),
    isPinned: boolean("is_pinned").default(false),
    isLocked: boolean("is_locked").default(false),
    replyCount: integer("reply_count").default(0),
    score: integer("score").default(0),
    isHidden: boolean("is_hidden").default(false),
    language: varchar("language", { length: 10 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clubIdx: index("club_threads_club_idx").on(table.clubId),
    languageIdx: index("club_threads_language_idx").on(table.language),
  }),
);

// Club Comments
export const clubComments = pgTable("club_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => clubThreads.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  content: text("content").notNull(),
  contentHtml: text("content_html"),
  score: integer("score").default(0),
  isHidden: boolean("is_hidden").default(false),
  language: varchar("language", { length: 10 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Club Thread Votes
export const clubThreadVotes = pgTable(
  "club_thread_votes",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => clubThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.userId] }),
    threadIdx: index("club_thread_votes_thread_idx").on(table.threadId),
  }),
);

// Club Comment Votes
export const clubCommentVotes = pgTable(
  "club_comment_votes",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => clubComments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.commentId, table.userId] }),
    commentIdx: index("club_comment_votes_comment_idx").on(table.commentId),
  }),
);

// Club Invitations (for private clubs)
export const clubInvitations = pgTable(
  "club_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id),
    inviteeId: uuid("invitee_id")
      .notNull()
      .references(() => users.id),
    status: varchar("status", { length: 20 }).default("pending"), // pending, accepted, declined
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    inviteeIdx: index("club_invitations_invitee_idx").on(
      table.inviteeId,
      table.status,
    ),
    clubIdx: index("club_invitations_club_idx").on(table.clubId),
  }),
);

// Home Rooms (User's personal spaces)
export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    visibility: roomVisibilityEnum("visibility").default("public"),
    isPinned: boolean("is_pinned").default(false),
    sortOrder: integer("sort_order").default(0),
    threadCount: integer("thread_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    ownerIdx: index("rooms_owner_idx").on(table.ownerId),
    visibilityIdx: index("rooms_visibility_idx").on(table.visibility),
  }),
);

// Room Members (for private rooms)
export const roomMembers = pgTable(
  "room_members",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.userId] }),
    userIdx: index("room_members_user_idx").on(table.userId),
  }),
);

// Room Threads
export const roomThreads = pgTable(
  "room_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content").notNull(),
    contentHtml: text("content_html"),
    isPinned: boolean("is_pinned").default(false),
    isLocked: boolean("is_locked").default(false),
    replyCount: integer("reply_count").default(0),
    score: integer("score").default(0),
    isHidden: boolean("is_hidden").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    roomIdx: index("room_threads_room_idx").on(table.roomId),
  }),
);

// Room Comments
export const roomComments = pgTable("room_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => roomThreads.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  content: text("content").notNull(),
  contentHtml: text("content_html"),
  score: integer("score").default(0),
  isHidden: boolean("is_hidden").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Room Thread Votes
export const roomThreadVotes = pgTable(
  "room_thread_votes",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => roomThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.userId] }),
    threadIdx: index("room_thread_votes_thread_idx").on(table.threadId),
  }),
);

// Room Comment Votes
export const roomCommentVotes = pgTable(
  "room_comment_votes",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => roomComments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.commentId, table.userId] }),
    commentIdx: index("room_comment_votes_comment_idx").on(table.commentId),
  }),
);

// Room Invitations
export const roomInvitations = pgTable(
  "room_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id),
    inviteeId: uuid("invitee_id")
      .notNull()
      .references(() => users.id),
    status: varchar("status", { length: 20 }).default("pending"), // pending, accepted, declined
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    inviteeIdx: index("room_invitations_invitee_idx").on(
      table.inviteeId,
      table.status,
    ),
  }),
);

// Notifications
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 50 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    link: varchar("link", { length: 500 }),
    read: boolean("read").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdx: index("notifications_user_idx").on(
      table.userId,
      table.read,
      table.createdAt,
    ),
  }),
);

// User Subscriptions
export const userSubscriptions = pgTable(
  "user_subscriptions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 50 }).notNull(), // 'user', 'municipality', 'place', 'club', 'tag'
    entityId: varchar("entity_id", { length: 255 }).notNull(),
    notify: varchar("notify", { length: 20 }).default("all"), // 'all', 'none', 'highlights'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.userId, table.entityType, table.entityId],
    }),
    entityIdx: index("user_subscriptions_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
    userIdx: index("user_subscriptions_user_idx").on(table.userId),
  }),
);

// Institution Topics — links institution to its discussion topic (tag-based channel)
export const institutionTopics = pgTable(
  "institution_topics",
  {
    institutionId: uuid("institution_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    topicTag: varchar("topic_tag", { length: 100 }).notNull(),
    relatedTags: varchar("related_tags", { length: 100 }).array().default([]),
    description: text("description"),
  },
  (table) => ({
    topicTagIdx: index("institution_topics_topic_tag_idx").on(table.topicTag),
  }),
);

// Institution Managers — links human users to institution accounts they manage
export const institutionManagers = pgTable(
  "institution_managers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: institutionManagerRoleEnum("role").notNull().default("editor"),
    status: institutionClaimStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"), // references admin_accounts (FK dropped for cross-table audit)
  },
  (table) => ({
    institutionIdx: index("institution_managers_institution_idx").on(
      table.institutionId,
    ),
    userIdx: index("institution_managers_user_idx").on(table.userId),
    uniqueManager: index("institution_managers_unique_idx").on(
      table.institutionId,
      table.userId,
    ),
  }),
);

// Tag Categories — optional metadata for tags: category, display name, description
export const tagCategories = pgTable(
  "tag_categories",
  {
    tag: varchar("tag", { length: 100 }).primaryKey(),
    category: varchar("category", { length: 100 }).notNull(),
    displayName: varchar("display_name", { length: 255 }),
    description: text("description"),
    scope: scopeEnum("scope"),
    sortOrder: integer("sort_order").default(0),
  },
  (table) => ({
    categoryIdx: index("tag_categories_category_idx").on(table.category),
    sortIdx: index("tag_categories_sort_idx").on(
      table.category,
      table.sortOrder,
    ),
  }),
);

// Direct Messages — Conversations
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    updatedIdx: index("conversations_updated_idx").on(table.updatedAt),
  }),
);

// Conversation Participants
export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).defaultNow(),
    isMuted: boolean("is_muted").default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.conversationId, table.userId] }),
    userIdx: index("conv_participants_user_idx").on(table.userId),
  }),
);

// Direct Messages
export const directMessages = pgTable(
  "direct_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    contentHtml: text("content_html"),
    isHidden: boolean("is_hidden").default(false),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    conversationIdx: index("dm_conversation_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  }),
);

// Edit History (polymorphic audit table for all content edits)
export const editHistory = pgTable(
  "edit_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentType: contentTypeEnum("content_type").notNull(),
    contentId: uuid("content_id").notNull(),
    editedBy: uuid("edited_by")
      .notNull()
      .references(() => users.id),
    previousContent: text("previous_content").notNull(),
    previousContentHtml: text("previous_content_html"),
    previousTitle: varchar("previous_title", { length: 500 }),
    editedAt: timestamp("edited_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    contentIdx: index("edit_history_content_idx").on(
      table.contentType,
      table.contentId,
    ),
    editedByIdx: index("edit_history_edited_by_idx").on(table.editedBy),
    editedAtIdx: index("edit_history_edited_at_idx").on(table.editedAt),
  }),
);

// Content Reports (DSA)
export const contentReports = pgTable(
  "content_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => users.id),
    contentType: contentTypeEnum("content_type").notNull(),
    contentId: uuid("content_id").notNull(),
    reason: reportReasonEnum("reason").notNull(),
    description: text("description"),
    status: reportStatusEnum("status").default("pending"),
    assignedTo: uuid("assigned_to"), // references admin_accounts (FK dropped for cross-table audit)
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("content_reports_status_idx").on(table.status),
    contentIdx: index("content_reports_content_idx").on(
      table.contentType,
      table.contentId,
    ),
    reporterIdx: index("content_reports_reporter_idx").on(table.reporterUserId),
  }),
);

// Moderation Actions (DSA audit log)
export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id").notNull(), // references admin_accounts (FK dropped for cross-table audit)
    actionType: actionTypeEnum("action_type").notNull(),
    targetType: contentTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reportId: uuid("report_id").references(() => contentReports.id),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    adminIdx: index("moderation_actions_admin_idx").on(table.adminUserId),
    targetIdx: index("moderation_actions_target_idx").on(
      table.targetType,
      table.targetId,
    ),
    createdIdx: index("moderation_actions_created_idx").on(table.createdAt),
  }),
);

// User Sanctions (DSA)
export const userSanctions = pgTable(
  "user_sanctions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sanctionType: sanctionTypeEnum("sanction_type").notNull(),
    reason: text("reason"),
    issuedBy: uuid("issued_by").notNull(), // references admin_accounts (FK dropped for cross-table audit)
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by"), // references admin_accounts (FK dropped for cross-table audit)
  },
  (table) => ({
    userIdx: index("user_sanctions_user_idx").on(table.userId),
    activeIdx: index("user_sanctions_active_idx").on(
      table.userId,
      table.sanctionType,
      table.revokedAt,
    ),
  }),
);

// Moderation Appeals (DSA)
export const moderationAppeals = pgTable(
  "moderation_appeals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sanctionId: uuid("sanction_id").references(() => userSanctions.id),
    reportId: uuid("report_id").references(() => contentReports.id),
    actionId: uuid("action_id").references(() => moderationActions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    status: appealStatusEnum("status").default("pending"),
    adminResponse: text("admin_response"),
    respondedBy: uuid("responded_by"), // references admin_accounts (FK dropped for cross-table audit)
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdx: index("moderation_appeals_user_idx").on(table.userId),
    statusIdx: index("moderation_appeals_status_idx").on(table.status),
  }),
);

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  municipality: one(municipalities, {
    fields: [users.municipalityId],
    references: [municipalities.id],
  }),
  inviter: one(users, {
    fields: [users.invitedBy],
    references: [users.id],
    relationName: "invitedUsers",
  }),
  invitedUsers: many(users, { relationName: "invitedUsers" }),
  createdInvites: many(inviteCodes, { relationName: "createdInvites" }),
  sessions: many(sessions),
  threads: many(threads),
  comments: many(comments),
  clubMemberships: many(clubMembers),
  notifications: many(notifications),
  rooms: many(rooms),
  roomMemberships: many(roomMembers),
  conversationParticipations: many(conversationParticipants),
  directMessages: many(directMessages),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  author: one(users, {
    fields: [threads.authorId],
    references: [users.id],
  }),
  sourceInstitution: one(users, {
    fields: [threads.sourceInstitutionId],
    references: [users.id],
    relationName: "sourceInstitutionThreads",
  }),
  municipality: one(municipalities, {
    fields: [threads.municipalityId],
    references: [municipalities.id],
  }),
  location: one(locations, {
    fields: [threads.locationId],
    references: [locations.id],
  }),
  place: one(places, {
    fields: [threads.placeId],
    references: [places.id],
  }),
  comments: many(comments),
  tags: many(threadTags),
  votes: many(threadVotes),
}));

export const institutionTopicsRelations = relations(
  institutionTopics,
  ({ one }) => ({
    institution: one(users, {
      fields: [institutionTopics.institutionId],
      references: [users.id],
    }),
  }),
);

export const institutionManagersRelations = relations(
  institutionManagers,
  ({ one }) => ({
    institution: one(users, {
      fields: [institutionManagers.institutionId],
      references: [users.id],
      relationName: "managedInstitution",
    }),
    user: one(users, {
      fields: [institutionManagers.userId],
      references: [users.id],
      relationName: "institutionManager",
    }),
    approver: one(users, {
      fields: [institutionManagers.approvedBy],
      references: [users.id],
      relationName: "claimApprover",
    }),
  }),
);

export const commentsRelations = relations(comments, ({ one, many }) => ({
  thread: one(threads, {
    fields: [comments.threadId],
    references: [threads.id],
  }),
  author: one(users, {
    fields: [comments.authorId],
    references: [users.id],
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: "commentReplies",
  }),
  replies: many(comments, { relationName: "commentReplies" }),
  votes: many(commentVotes),
}));

export const commentVotesRelations = relations(commentVotes, ({ one }) => ({
  comment: one(comments, {
    fields: [commentVotes.commentId],
    references: [comments.id],
  }),
  user: one(users, {
    fields: [commentVotes.userId],
    references: [users.id],
  }),
}));

export const threadVotesRelations = relations(threadVotes, ({ one }) => ({
  thread: one(threads, {
    fields: [threadVotes.threadId],
    references: [threads.id],
  }),
  user: one(users, {
    fields: [threadVotes.userId],
    references: [users.id],
  }),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  parent: one(locations, {
    fields: [locations.parentId],
    references: [locations.id],
    relationName: "locationChildren",
  }),
  children: many(locations, { relationName: "locationChildren" }),
  threads: many(threads),
  places: many(places),
}));

export const userSubscriptionsRelations = relations(
  userSubscriptions,
  ({ one }) => ({
    user: one(users, {
      fields: [userSubscriptions.userId],
      references: [users.id],
    }),
  }),
);

export const clubsRelations = relations(clubs, ({ one, many }) => ({
  creator: one(users, {
    fields: [clubs.creatorId],
    references: [users.id],
  }),
  place: one(places, {
    fields: [clubs.placeId],
    references: [places.id],
  }),
  municipality: one(municipalities, {
    fields: [clubs.municipalityId],
    references: [municipalities.id],
  }),
  members: many(clubMembers),
  threads: many(clubThreads),
}));

// Places Relations
export const placesRelations = relations(places, ({ one, many }) => ({
  municipality: one(municipalities, {
    fields: [places.municipalityId],
    references: [municipalities.id],
  }),
  location: one(locations, {
    fields: [places.locationId],
    references: [locations.id],
  }),
  creator: one(users, {
    fields: [places.createdBy],
    references: [users.id],
  }),
  threads: many(threads),
  clubs: many(clubs),
}));

export const municipalitiesRelations = relations(
  municipalities,
  ({ many }) => ({
    users: many(users),
    threads: many(threads),
    places: many(places),
    clubs: many(clubs),
  }),
);

export const clubMembersRelations = relations(clubMembers, ({ one }) => ({
  club: one(clubs, {
    fields: [clubMembers.clubId],
    references: [clubs.id],
  }),
  user: one(users, {
    fields: [clubMembers.userId],
    references: [users.id],
  }),
}));

// Home Relations
export const roomsRelations = relations(rooms, ({ one, many }) => ({
  owner: one(users, {
    fields: [rooms.ownerId],
    references: [users.id],
  }),
  members: many(roomMembers),
  threads: many(roomThreads),
  invitations: many(roomInvitations),
}));

export const roomMembersRelations = relations(roomMembers, ({ one }) => ({
  room: one(rooms, {
    fields: [roomMembers.roomId],
    references: [rooms.id],
  }),
  user: one(users, {
    fields: [roomMembers.userId],
    references: [users.id],
  }),
}));

export const roomThreadsRelations = relations(roomThreads, ({ one, many }) => ({
  room: one(rooms, {
    fields: [roomThreads.roomId],
    references: [rooms.id],
  }),
  author: one(users, {
    fields: [roomThreads.authorId],
    references: [users.id],
  }),
  comments: many(roomComments),
  votes: many(roomThreadVotes),
}));

export const roomCommentsRelations = relations(roomComments, ({ one }) => ({
  thread: one(roomThreads, {
    fields: [roomComments.threadId],
    references: [roomThreads.id],
  }),
  author: one(users, {
    fields: [roomComments.authorId],
    references: [users.id],
  }),
}));

export const roomThreadVotesRelations = relations(
  roomThreadVotes,
  ({ one }) => ({
    thread: one(roomThreads, {
      fields: [roomThreadVotes.threadId],
      references: [roomThreads.id],
    }),
    user: one(users, {
      fields: [roomThreadVotes.userId],
      references: [users.id],
    }),
  }),
);

export const roomCommentVotesRelations = relations(
  roomCommentVotes,
  ({ one }) => ({
    comment: one(roomComments, {
      fields: [roomCommentVotes.commentId],
      references: [roomComments.id],
    }),
    user: one(users, {
      fields: [roomCommentVotes.userId],
      references: [users.id],
    }),
  }),
);

// Invite Codes Relations
export const inviteCodesRelations = relations(inviteCodes, ({ one }) => ({
  creator: one(users, {
    fields: [inviteCodes.createdBy],
    references: [users.id],
    relationName: "createdInvites",
  }),
  usedByUser: one(users, {
    fields: [inviteCodes.usedBy],
    references: [users.id],
    relationName: "usedInvite",
  }),
}));

// DM Relations
export const conversationsRelations = relations(conversations, ({ many }) => ({
  participants: many(conversationParticipants),
  messages: many(directMessages),
}));

export const conversationParticipantsRelations = relations(
  conversationParticipants,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationParticipants.conversationId],
      references: [conversations.id],
    }),
    user: one(users, {
      fields: [conversationParticipants.userId],
      references: [users.id],
    }),
  }),
);

export const directMessagesRelations = relations(directMessages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [directMessages.conversationId],
    references: [conversations.id],
  }),
  author: one(users, {
    fields: [directMessages.authorId],
    references: [users.id],
  }),
}));

// Edit History relations
export const editHistoryRelations = relations(editHistory, ({ one }) => ({
  editor: one(users, {
    fields: [editHistory.editedBy],
    references: [users.id],
  }),
}));

// Moderation relations
export const contentReportsRelations = relations(contentReports, ({ one }) => ({
  reporter: one(users, {
    fields: [contentReports.reporterUserId],
    references: [users.id],
    relationName: "reportedByUser",
  }),
  assignee: one(users, {
    fields: [contentReports.assignedTo],
    references: [users.id],
    relationName: "assignedReports",
  }),
}));

export const moderationActionsRelations = relations(
  moderationActions,
  ({ one }) => ({
    admin: one(users, {
      fields: [moderationActions.adminUserId],
      references: [users.id],
    }),
    report: one(contentReports, {
      fields: [moderationActions.reportId],
      references: [contentReports.id],
    }),
  }),
);

export const userSanctionsRelations = relations(userSanctions, ({ one }) => ({
  user: one(users, {
    fields: [userSanctions.userId],
    references: [users.id],
    relationName: "sanctions",
  }),
  issuer: one(users, {
    fields: [userSanctions.issuedBy],
    references: [users.id],
    relationName: "issuedSanctions",
  }),
  revoker: one(users, {
    fields: [userSanctions.revokedBy],
    references: [users.id],
    relationName: "revokedSanctions",
  }),
}));

export const moderationAppealsRelations = relations(
  moderationAppeals,
  ({ one }) => ({
    sanction: one(userSanctions, {
      fields: [moderationAppeals.sanctionId],
      references: [userSanctions.id],
    }),
    report: one(contentReports, {
      fields: [moderationAppeals.reportId],
      references: [contentReports.id],
    }),
    action: one(moderationActions, {
      fields: [moderationAppeals.actionId],
      references: [moderationActions.id],
    }),
    user: one(users, {
      fields: [moderationAppeals.userId],
      references: [users.id],
    }),
    responder: one(users, {
      fields: [moderationAppeals.respondedBy],
      references: [users.id],
    }),
  }),
);

// Types for insertion
export type NewUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewAdminAccount = typeof adminAccounts.$inferInsert;
export type AdminAccount = typeof adminAccounts.$inferSelect;
export type NewAdminSession = typeof adminSessions.$inferInsert;
export type AdminSession = typeof adminSessions.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Thread = typeof threads.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewClub = typeof clubs.$inferInsert;
export type Club = typeof clubs.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type Room = typeof rooms.$inferSelect;
export type NewRoomThread = typeof roomThreads.$inferInsert;
export type RoomThread = typeof roomThreads.$inferSelect;
export type NewRoomComment = typeof roomComments.$inferInsert;
export type RoomComment = typeof roomComments.$inferSelect;
export type NewPlace = typeof places.$inferInsert;
export type Place = typeof places.$inferSelect;
export type Municipality = typeof municipalities.$inferSelect;
export type NewInviteCode = typeof inviteCodes.$inferInsert;
export type InviteCode = typeof inviteCodes.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type Location = typeof locations.$inferSelect;
export type NewThreadVote = typeof threadVotes.$inferInsert;
export type ThreadVote = typeof threadVotes.$inferSelect;
export type NewUserSubscription = typeof userSubscriptions.$inferInsert;
export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type NewInstitutionTopic = typeof institutionTopics.$inferInsert;
export type InstitutionTopic = typeof institutionTopics.$inferSelect;
export type NewTagCategory = typeof tagCategories.$inferInsert;
export type TagCategory = typeof tagCategories.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversationParticipant =
  typeof conversationParticipants.$inferInsert;
export type ConversationParticipant =
  typeof conversationParticipants.$inferSelect;
export type NewDirectMessage = typeof directMessages.$inferInsert;
export type DirectMessage = typeof directMessages.$inferSelect;
export type NewContentReport = typeof contentReports.$inferInsert;
export type ContentReport = typeof contentReports.$inferSelect;
export type NewModerationAction = typeof moderationActions.$inferInsert;
export type ModerationAction = typeof moderationActions.$inferSelect;
export type NewUserSanction = typeof userSanctions.$inferInsert;
export type UserSanction = typeof userSanctions.$inferSelect;
export type NewModerationAppeal = typeof moderationAppeals.$inferInsert;
export type ModerationAppeal = typeof moderationAppeals.$inferSelect;
export type NewEditHistory = typeof editHistory.$inferInsert;
export type EditHistory = typeof editHistory.$inferSelect;

// Push Subscriptions (Web Push API)
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdx: index("push_subscriptions_user_idx").on(table.userId),
    endpointIdx: index("push_subscriptions_endpoint_idx").on(table.endpoint),
  }),
);

export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

// Native push device tokens (FCM)
export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: varchar("platform", { length: 10 }).notNull(), // 'android' | 'ios'
    deviceId: varchar("device_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdx: index("device_tokens_user_idx").on(table.userId),
    tokenIdx: uniqueIndex("device_tokens_token_idx").on(table.token),
  }),
);

export type NewDeviceToken = typeof deviceTokens.$inferInsert;
export type DeviceToken = typeof deviceTokens.$inferSelect;

// Site settings (key-value)
export const siteSettings = pgTable("site_settings", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Link preview cache
export const linkPreviews = pgTable("link_previews", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull().unique(),
  title: text("title"),
  description: text("description"),
  imageUrl: text("image_url"),
  siteName: text("site_name"),
  faviconUrl: text("favicon_url"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  error: boolean("error").default(false),
});

export type NewLinkPreview = typeof linkPreviews.$inferInsert;
export type LinkPreviewRecord = typeof linkPreviews.$inferSelect;

// System announcements (admin broadcast)
export const announcementTypeEnum = pgEnum("announcement_type", [
  "info",
  "warning",
  "critical",
]);

export const systemAnnouncements = pgTable("system_announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: announcementTypeEnum("type").default("info").notNull(),
  active: boolean("active").default(true).notNull(),
  createdBy: uuid("created_by")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export type SystemAnnouncement = typeof systemAnnouncements.$inferSelect;
export type NewSystemAnnouncement = typeof systemAnnouncements.$inferInsert;

// ============================================
// DISCOVERY & TRENDING
// ============================================

// Thread views — track unique views per thread
export const threadViews = pgTable(
  "thread_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sessionHash: varchar("session_hash", { length: 64 }), // Anonymous tracking via hashed session
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    threadIdx: index("thread_views_thread_idx").on(table.threadId),
    createdIdx: index("thread_views_created_idx").on(table.createdAt),
    // Prevent duplicate views from same user/session
    userThreadIdx: index("thread_views_user_thread_idx").on(
      table.threadId,
      table.userId,
    ),
  }),
);

// Bookmarks — user-saved threads
export const bookmarks = pgTable(
  "bookmarks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.threadId] }),
    userIdx: index("bookmarks_user_idx").on(table.userId),
  }),
);

// Trending cache — pre-computed trending data, refreshed every 15 minutes
export const trendingCache = pgTable(
  "trending_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: varchar("entity_type", { length: 50 }).notNull(), // 'thread', 'tag', 'municipality'
    entityId: varchar("entity_id", { length: 255 }).notNull(),
    score: decimal("score", { precision: 12, scale: 4 }).notNull(),
    metadata: jsonb("metadata").default({}), // Extra data (title, tag count, etc.)
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    typeScoreIdx: index("trending_cache_type_score_idx").on(
      table.entityType,
      table.score,
    ),
    uniqueEntity: uniqueIndex("trending_cache_unique_idx").on(
      table.entityType,
      table.entityId,
    ),
  }),
);

export type ThreadView = typeof threadViews.$inferSelect;
export type NewThreadView = typeof threadViews.$inferInsert;
export type Bookmark = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;
export type TrendingCacheEntry = typeof trendingCache.$inferSelect;
export type NewTrendingCacheEntry = typeof trendingCache.$inferInsert;

// FTN Pending Registrations — temporary storage for strong authentication claims during registration flow
export const ftnPendingRegistrations = pgTable(
  "ftn_pending_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: varchar("token", { length: 255 }).notNull(),
    givenName: varchar("given_name", { length: 255 }).notNull(),
    familyName: varchar("family_name", { length: 255 }).notNull(),
    sub: varchar("sub", { length: 255 }).notNull(),
    country: varchar("country", { length: 10 }),
    inviteCode: varchar("invite_code", { length: 50 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tokenIdx: index("ftn_pending_token_idx").on(table.token),
    expiresIdx: index("ftn_pending_expires_idx").on(table.expiresAt),
  }),
);

export type FtnPendingRegistration =
  typeof ftnPendingRegistrations.$inferSelect;
export type NewFtnPendingRegistration =
  typeof ftnPendingRegistrations.$inferInsert;
