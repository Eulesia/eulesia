export async function runStartupMigrations() {
  const { db } = await import("./index.js");
  const { sql } = await import("drizzle-orm");

  // 0009: language field (idempotent)
  await db.execute(
    sql`ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "language" varchar(10)`,
  );
  await db.execute(
    sql`ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "language" varchar(10)`,
  );
  await db.execute(
    sql`ALTER TABLE "club_threads" ADD COLUMN IF NOT EXISTS "language" varchar(10)`,
  );
  await db.execute(
    sql`ALTER TABLE "club_comments" ADD COLUMN IF NOT EXISTS "language" varchar(10)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "threads_language_idx" ON "threads" ("language")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "club_threads_language_idx" ON "club_threads" ("language")`,
  );
  // 0010: clubs cover image
  await db.execute(
    sql`ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "cover_image_url" varchar(500)`,
  );
  // 0011: remove seed mock clubs (Tampere History, Cycling, Hervanta)
  await db.execute(
    sql`DELETE FROM "club_comments" WHERE "thread_id" IN (SELECT "id" FROM "club_threads" WHERE "club_id" IN (SELECT "id" FROM "clubs" WHERE "slug" IN ('tampere-history', 'cycling-tampere', 'hervanta-neighbors')))`,
  );
  await db.execute(
    sql`DELETE FROM "club_threads" WHERE "club_id" IN (SELECT "id" FROM "clubs" WHERE "slug" IN ('tampere-history', 'cycling-tampere', 'hervanta-neighbors'))`,
  );
  await db.execute(
    sql`DELETE FROM "club_members" WHERE "club_id" IN (SELECT "id" FROM "clubs" WHERE "slug" IN ('tampere-history', 'cycling-tampere', 'hervanta-neighbors'))`,
  );
  await db.execute(
    sql`DELETE FROM "clubs" WHERE "slug" IN ('tampere-history', 'cycling-tampere', 'hervanta-neighbors')`,
  );
  // 0012: is_hidden columns
  await db.execute(
    sql`ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "is_hidden" boolean DEFAULT false`,
  );
  await db.execute(
    sql`ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "is_hidden" boolean DEFAULT false`,
  );
  await db.execute(
    sql`ALTER TABLE "club_threads" ADD COLUMN IF NOT EXISTS "is_hidden" boolean DEFAULT false`,
  );
  await db.execute(
    sql`ALTER TABLE "club_comments" ADD COLUMN IF NOT EXISTS "is_hidden" boolean DEFAULT false`,
  );
  // room_messages is_hidden removed — table dropped by migration 0017
  // 0013: DSA moderation tables
  await db.execute(
    sql`DO $$ BEGIN CREATE TYPE report_reason AS ENUM ('illegal', 'harassment', 'spam', 'misinformation', 'other'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(
    sql`DO $$ BEGIN CREATE TYPE report_status AS ENUM ('pending', 'reviewing', 'resolved', 'dismissed'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(
    sql`DO $$ BEGIN CREATE TYPE content_type AS ENUM ('thread', 'comment', 'club_thread', 'club_comment', 'club', 'user', 'room_message', 'dm'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(
    sql`DO $$ BEGIN CREATE TYPE action_type AS ENUM ('content_removed', 'content_restored', 'user_warned', 'user_suspended', 'user_banned', 'user_unbanned', 'report_dismissed', 'report_resolved', 'role_changed'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(
    sql`DO $$ BEGIN CREATE TYPE sanction_type AS ENUM ('warning', 'suspension', 'ban'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(
    sql`DO $$ BEGIN CREATE TYPE appeal_status AS ENUM ('pending', 'accepted', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  // 0014: Sync enum values — add missing values from schema
  await db.execute(
    sql`DO $$ BEGIN ALTER TYPE content_type ADD VALUE IF NOT EXISTS 'system'; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(
    sql`DO $$ BEGIN ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'user_verified'; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(
    sql`DO $$ BEGIN ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'user_unverified'; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(
    sql`DO $$ BEGIN ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'settings_changed'; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(
    sql`DO $$ BEGIN ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'invite_count_changed'; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "content_reports" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "reporter_user_id" UUID NOT NULL REFERENCES "users"("id"), "content_type" content_type NOT NULL, "content_id" UUID NOT NULL, "reason" report_reason NOT NULL, "description" TEXT, "status" report_status DEFAULT 'pending', "assigned_to" UUID REFERENCES "users"("id"), "resolved_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ DEFAULT NOW())`,
  );
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "moderation_actions" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "admin_user_id" UUID NOT NULL REFERENCES "users"("id"), "action_type" action_type NOT NULL, "target_type" content_type NOT NULL, "target_id" UUID NOT NULL, "report_id" UUID REFERENCES "content_reports"("id"), "reason" TEXT, "metadata" JSONB, "created_at" TIMESTAMPTZ DEFAULT NOW())`,
  );
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "user_sanctions" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL REFERENCES "users"("id"), "sanction_type" sanction_type NOT NULL, "reason" TEXT, "issued_by" UUID NOT NULL REFERENCES "users"("id"), "issued_at" TIMESTAMPTZ DEFAULT NOW(), "expires_at" TIMESTAMPTZ, "revoked_at" TIMESTAMPTZ, "revoked_by" UUID REFERENCES "users"("id"))`,
  );
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "moderation_appeals" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "sanction_id" UUID REFERENCES "user_sanctions"("id"), "report_id" UUID REFERENCES "content_reports"("id"), "action_id" UUID REFERENCES "moderation_actions"("id"), "user_id" UUID NOT NULL REFERENCES "users"("id"), "reason" TEXT NOT NULL, "status" appeal_status DEFAULT 'pending', "admin_response" TEXT, "responded_by" UUID REFERENCES "users"("id"), "responded_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ DEFAULT NOW())`,
  );
  // 0015: Push subscriptions table
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx" ON "push_subscriptions" ("endpoint")`,
  );

  // Native push device tokens (FCM)
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "device_tokens" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token" TEXT NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "device_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "device_tokens_user_idx" ON "device_tokens" ("user_id")`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "device_tokens_token_idx" ON "device_tokens" ("token")`,
  );

  // 0016: Waitlist table
  await db.execute(
    sql`DO $$ BEGIN CREATE TYPE waitlist_status AS ENUM ('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "waitlist" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "status" waitlist_status DEFAULT 'pending',
    "locale" VARCHAR(10) DEFAULT 'en',
    "ip_address" INET,
    "invite_code_id" UUID REFERENCES "invite_codes"("id"),
    "approved_by" UUID REFERENCES "users"("id"),
    "rejected_by" UUID REFERENCES "users"("id"),
    "approved_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "email_sent_at" TIMESTAMPTZ,
    "note" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_email_idx" ON "waitlist" ("email")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "waitlist_status_idx" ON "waitlist" ("status")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "waitlist_created_idx" ON "waitlist" ("created_at")`,
  );
  // 0016: bootstrap-managed admin identity metadata
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "managed_by" varchar(50)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "users_managed_by_idx" ON "users" ("managed_by")`,
  );
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "managed_key" varchar(100)`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "users_managed_key_unique_idx" ON "users" ("managed_by", "managed_key")`,
  );
  // 0018: enforce FTN subject uniqueness
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "users_rp_subject_idx" ON "users" ("rp_subject")`,
  );

  // 0017: Convert rooms from flat chat to threaded (club-like)
  await db.execute(sql`DROP TABLE IF EXISTS "message_reactions"`);
  await db.execute(sql`DROP TABLE IF EXISTS "room_messages"`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "room_threads" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
    "author_id" UUID NOT NULL REFERENCES "users"("id"),
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "content_html" TEXT,
    "is_pinned" BOOLEAN DEFAULT false,
    "is_locked" BOOLEAN DEFAULT false,
    "reply_count" INTEGER DEFAULT 0,
    "score" INTEGER DEFAULT 0,
    "is_hidden" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "room_threads_room_idx" ON "room_threads" ("room_id")`,
  );
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "room_comments" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL REFERENCES "room_threads"("id") ON DELETE CASCADE,
    "parent_id" UUID,
    "author_id" UUID NOT NULL REFERENCES "users"("id"),
    "content" TEXT NOT NULL,
    "content_html" TEXT,
    "score" INTEGER DEFAULT 0,
    "is_hidden" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "room_thread_votes" (
    "thread_id" UUID NOT NULL REFERENCES "room_threads"("id") ON DELETE CASCADE,
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY ("thread_id", "user_id")
  )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "room_thread_votes_thread_idx" ON "room_thread_votes" ("thread_id")`,
  );
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "room_comment_votes" (
    "comment_id" UUID NOT NULL REFERENCES "room_comments"("id") ON DELETE CASCADE,
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY ("comment_id", "user_id")
  )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "room_comment_votes_comment_idx" ON "room_comment_votes" ("comment_id")`,
  );
  // Rename message_count -> thread_count (idempotent)
  await db.execute(
    sql`DO $$ BEGIN ALTER TABLE "rooms" RENAME COLUMN "message_count" TO "thread_count"; EXCEPTION WHEN undefined_column THEN null; END $$`,
  );

  // 0019: Separate admin accounts from users table
  // Create admin_accounts table
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "admin_accounts" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "username" VARCHAR(50) UNIQUE NOT NULL,
    "email" VARCHAR(255) UNIQUE,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "managed_by" VARCHAR(50) NOT NULL,
    "managed_key" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW(),
    "last_seen_at" TIMESTAMPTZ
  )`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "admin_accounts_managed_key_unique_idx" ON "admin_accounts" ("managed_by", "managed_key")`,
  );

  // Create admin_sessions table
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "admin_sessions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL REFERENCES "admin_accounts"("id") ON DELETE CASCADE,
    "token_hash" VARCHAR(255) NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "admin_sessions_admin_idx" ON "admin_sessions" ("admin_id")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "admin_sessions_token_idx" ON "admin_sessions" ("token_hash")`,
  );

  // Migrate existing admin data from users → admin_accounts (preserving IDs)
  await db.execute(sql`
    INSERT INTO "admin_accounts" ("id", "username", "email", "password_hash", "name", "managed_by", "managed_key", "created_at", "updated_at", "last_seen_at")
    SELECT "id", "username", "email", "password_hash", "name", "managed_by", "managed_key", "created_at", "updated_at", "last_seen_at"
    FROM "users" WHERE "managed_by" = 'sops_admin'
    ON CONFLICT ("managed_by", "managed_key") DO NOTHING
  `);

  // Drop FK constraints on admin-actor columns (these now reference admin_accounts, not users)
  await db.execute(
    sql`ALTER TABLE "moderation_actions" DROP CONSTRAINT IF EXISTS "moderation_actions_admin_user_id_users_id_fk"`,
  );
  await db.execute(
    sql`ALTER TABLE "user_sanctions" DROP CONSTRAINT IF EXISTS "user_sanctions_issued_by_users_id_fk"`,
  );
  await db.execute(
    sql`ALTER TABLE "user_sanctions" DROP CONSTRAINT IF EXISTS "user_sanctions_revoked_by_users_id_fk"`,
  );
  await db.execute(
    sql`ALTER TABLE "content_reports" DROP CONSTRAINT IF EXISTS "content_reports_assigned_to_users_id_fk"`,
  );
  await db.execute(
    sql`ALTER TABLE "moderation_appeals" DROP CONSTRAINT IF EXISTS "moderation_appeals_responded_by_users_id_fk"`,
  );
  await db.execute(
    sql`ALTER TABLE "waitlist" DROP CONSTRAINT IF EXISTS "waitlist_approved_by_users_id_fk"`,
  );
  await db.execute(
    sql`ALTER TABLE "waitlist" DROP CONSTRAINT IF EXISTS "waitlist_rejected_by_users_id_fk"`,
  );
  await db.execute(
    sql`ALTER TABLE "invite_codes" DROP CONSTRAINT IF EXISTS "invite_codes_created_by_users_id_fk"`,
  );

  // Delete admin sessions and user rows
  await db.execute(
    sql`DELETE FROM "sessions" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "managed_by" = 'sops_admin')`,
  );
  await db.execute(sql`DELETE FROM "users" WHERE "managed_by" = 'sops_admin'`);

  // Drop managed columns from users table
  await db.execute(sql`DROP INDEX IF EXISTS "users_managed_by_idx"`);
  await db.execute(sql`DROP INDEX IF EXISTS "users_managed_key_unique_idx"`);
  await db.execute(sql`ALTER TABLE "users" DROP COLUMN IF EXISTS "managed_by"`);
  await db.execute(
    sql`ALTER TABLE "users" DROP COLUMN IF EXISTS "managed_key"`,
  );
}
