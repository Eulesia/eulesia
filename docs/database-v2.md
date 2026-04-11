# Eulesia v2 Database Schema

## Design Principles

1. **UUIDv7 everywhere** — app-generated in Rust (single consistent policy), time-sortable
2. **Server-blind for E2EE** — encrypted content is `bytea` (opaque). Attachment metadata (filename, size, content_type) is partially server-visible — this is **content-blind, not metadata-blind**
3. **Current state vs history** — explicit split between current-state tables and append-only event/history tables
4. **Audit columns** — `created_at` on all tables, `updated_at` on mutable tables with trigger enforcement
5. **Foreign keys enforced** — at the database level, including cross-column constraints (sender → device ownership)
6. **Soft deletes** — `deleted_at` on user-facing data (users, conversations, messages, public content). Hard delete only for ephemeral material (sessions, delivery queues, auth artifacts)
7. **CHECK constraints** — push all known invariants into the DB (non-empty keys, self-reference prevention, enum values)
8. **sqlx** — compile-time checked queries in Rust, raw SQL migrations, app-generated UUIDv7
9. **Case-insensitive identity** — `citext` for usernames and emails

## Schema Overview

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│   users      │──┬──│  devices     │     │  conversations   │
│              │  │  │  (keys)     │     │  (direct, group, │
│  identity    │  │  └──────┬──────┘     │   channel)       │
│  profile     │  │         │            └────────┬─────────┘
│  settings    │  │  ┌──────┴──────┐              │
└──────┬───────┘  ├──│  sessions   │     ┌────────┴─────────┐
       │          │  └─────────────┘     │  memberships     │
       │          │                      │  (current state) │
       │          │  ┌─────────────┐     └────────┬─────────┘
       │          ├──│  pre_keys   │              │
       │          │  └─────────────┘     ┌────────┴─────────┐
       │          │                      │  membership_     │
       │          │  ┌─────────────┐     │  events          │
       │          └──│  signed_    │     │  (append-only)   │
       │             │  pre_keys   │     └────────┬─────────┘
       │             └─────────────┘              │
       │                                 ┌────────┴─────────┐
       │          ┌─────────────┐        │  messages        │
       ├──────────│  follows     │        │  (encrypted)     │
       │          │  blocks      │        └────────┬─────────┘
       │          │  mutes       │                 │
       │          └─────────────┘        ┌────────┴─────────┐
       │                                 │  message_device_ │
       │          ┌─────────────┐        │  queue           │
       └──────────│  threads     │        │  (delivery)      │
                  │  comments    │        └──────────────────┘
                  │  votes       │
                  └─────────────┘
```

## Shared Infrastructure

### updated_at trigger

All mutable tables use this trigger to enforce `updated_at`:

```sql
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### citext extension

```sql
CREATE EXTENSION IF NOT EXISTS citext;
```

---

## Domain 1: Identity

### users

```sql
CREATE TABLE users (
    id              uuid PRIMARY KEY,
    username        citext NOT NULL UNIQUE,
    email           citext UNIQUE,
    password_hash   varchar(255),
    name            varchar(255) NOT NULL,
    avatar_url      varchar(500),
    bio             text,

    role            varchar(20) NOT NULL DEFAULT 'citizen',
    institution_type varchar(50),
    institution_name varchar(255),

    identity_verified    boolean NOT NULL DEFAULT false,
    identity_provider    varchar(50),
    identity_level       varchar(20) NOT NULL DEFAULT 'basic',
    verified_name        varchar(255),

    municipality_id uuid REFERENCES municipalities(id),
    locale          varchar(10) NOT NULL DEFAULT 'en',

    deleted_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz,

    CHECK (char_length(username::text) >= 3),
    CHECK (role IN ('citizen', 'institution', 'moderator', 'admin'))
);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**GDPR PII**: `email`, `name`, `avatar_url`, `bio`, `verified_name`, `password_hash`

### devices

```sql
CREATE TABLE devices (
    id              uuid PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name    varchar(255),
    platform        varchar(20) NOT NULL,

    identity_key    bytea,

    last_seen_at    timestamptz,
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CHECK (platform IN ('web', 'android', 'ios', 'desktop')),
    CHECK (identity_key IS NULL OR octet_length(identity_key) > 0)
);

CREATE UNIQUE INDEX uq_devices_id_user ON devices (id, user_id);
CREATE INDEX idx_devices_user_active ON devices (user_id) WHERE revoked_at IS NULL;
```

`identity_key` is retained only for historical compatibility and is nullable on
current branches. Active E2EE device identity lives in the Matrix device key
columns added later.

### one_time_pre_keys

Consumable keys for Matrix one-time-key and fallback-key claims.

```sql
CREATE TABLE one_time_pre_keys (
    id              uuid PRIMARY KEY,
    device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    key_id          bigint NOT NULL,
    key_data        bytea NOT NULL,
    uploaded_at     timestamptz NOT NULL DEFAULT now(),
    consumed_at     timestamptz,

    CHECK (octet_length(key_data) > 0),
    UNIQUE (device_id, key_id)
);

CREATE INDEX idx_otpk_device_unconsumed ON one_time_pre_keys (device_id, uploaded_at)
    WHERE consumed_at IS NULL;
```

### sessions

```sql
CREATE TABLE sessions (
    id              uuid PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id       uuid REFERENCES devices(id) ON DELETE SET NULL,
    token_hash      varchar(255) NOT NULL,
    ip_address      inet,
    user_agent      text,
    expires_at      timestamptz NOT NULL,
    last_used_at    timestamptz,
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_token ON sessions (token_hash);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
```

---

## Domain 2: Conversations & Messaging (E2EE)

### conversations

```sql
CREATE TYPE conversation_type AS ENUM ('direct', 'group', 'channel');
CREATE TYPE encryption_mode AS ENUM ('e2ee', 'server_visible');

CREATE TABLE conversations (
    id              uuid PRIMARY KEY,
    type            conversation_type NOT NULL,
    encryption      encryption_mode NOT NULL DEFAULT 'e2ee',
    name            varchar(255),
    description     text,
    avatar_url      varchar(500),
    creator_id      uuid REFERENCES users(id),
    is_public       boolean NOT NULL DEFAULT false,

    current_epoch   bigint NOT NULL DEFAULT 0 CHECK (current_epoch >= 0),

    deleted_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### direct_conversations

Canonical 1:1 uniqueness enforcement.

```sql
CREATE TABLE direct_conversations (
    conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    user_a_id       uuid NOT NULL REFERENCES users(id),
    user_b_id       uuid NOT NULL REFERENCES users(id),

    CHECK (user_a_id <> user_b_id),
    CHECK (user_a_id < user_b_id),
    UNIQUE (user_a_id, user_b_id)
);
```

### conversation_epochs

Immutable epoch rotation history.

```sql
CREATE TABLE conversation_epochs (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    epoch           bigint NOT NULL CHECK (epoch >= 0),
    rotated_by      uuid REFERENCES users(id),
    reason          varchar(50) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (conversation_id, epoch),
    CHECK (reason IN ('created', 'member_added', 'member_removed', 'key_compromise', 'scheduled'))
);
```

### memberships (current state)

Exactly one active row per user per conversation.

```sql
CREATE TYPE membership_role AS ENUM ('member', 'moderator', 'admin', 'owner');

CREATE TABLE memberships (
    id              uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            membership_role NOT NULL DEFAULT 'member',
    joined_epoch    bigint NOT NULL CHECK (joined_epoch >= 0),

    left_at         timestamptz,
    removed_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_memberships_active
    ON memberships (conversation_id, user_id) WHERE left_at IS NULL;
CREATE INDEX idx_memberships_conv_active
    ON memberships (conversation_id) WHERE left_at IS NULL;
CREATE INDEX idx_memberships_user_active
    ON memberships (user_id, conversation_id) WHERE left_at IS NULL;
```

### membership_events (append-only history)

Immutable audit trail. Source of truth for membership provenance.

```sql
CREATE TABLE membership_events (
    id              uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id),
    event_type      varchar(30) NOT NULL,
    epoch           bigint NOT NULL CHECK (epoch >= 0),
    actor_id        uuid REFERENCES users(id),
    metadata        jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CHECK (event_type IN ('joined', 'left', 'removed', 'role_changed', 'invited'))
);

CREATE INDEX idx_membership_events_conv ON membership_events (conversation_id, created_at);
```

### messages

Encrypted message envelopes. Server stores opaque blobs.

```sql
CREATE TABLE messages (
    id               uuid PRIMARY KEY,
    conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id        uuid NOT NULL,
    sender_device_id uuid NOT NULL,
    epoch            bigint NOT NULL CHECK (epoch >= 0),

    ciphertext       bytea NOT NULL,
    message_type     varchar(20) NOT NULL DEFAULT 'text',
    server_ts        timestamptz NOT NULL DEFAULT now(),

    CHECK (octet_length(ciphertext) > 0),
    CHECK (message_type IN ('text', 'media', 'system', 'reaction', 'redaction')),
    FOREIGN KEY (sender_device_id, sender_id) REFERENCES devices (id, user_id)
);

CREATE INDEX idx_messages_conv_order ON messages (conversation_id, id DESC);
CREATE INDEX idx_messages_sender ON messages (sender_id);
```

### message_redactions

Deletion/redaction state. Immutable — messages are never mutated.

```sql
CREATE TABLE message_redactions (
    message_id      uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    redacted_by     uuid NOT NULL REFERENCES users(id),
    reason          varchar(50) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CHECK (reason IN ('sender_unsend', 'moderation', 'retention_expired'))
);
```

### message_device_queue

Delivery outbox — per-device encrypted copies. Hot table, not permanent history.

```sql
CREATE TABLE message_device_queue (
    message_id      uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ciphertext      bytea NOT NULL,

    enqueued_at     timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz,
    failed_at       timestamptz,
    attempt_count   smallint NOT NULL DEFAULT 0,

    PRIMARY KEY (message_id, device_id),
    CHECK (octet_length(ciphertext) > 0)
);

CREATE INDEX idx_mdq_device_pending ON message_device_queue (device_id, enqueued_at)
    WHERE delivered_at IS NULL AND failed_at IS NULL;
```

Delivered rows are garbage-collected periodically. This is a **delivery queue**, not permanent ledger.

### media

Encrypted attachment metadata. Content-blind, but metadata partially visible.

```sql
CREATE TABLE media (
    id              uuid PRIMARY KEY,
    uploader_id     uuid NOT NULL REFERENCES users(id),
    conversation_id uuid REFERENCES conversations(id),

    file_name       varchar(255),
    content_type    varchar(100),
    size_bytes      bigint NOT NULL,
    storage_key     varchar(500) NOT NULL,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CHECK (size_bytes >= 0)
);
```

**Privacy note**: `file_name`, `content_type`, `size_bytes` are server-visible metadata. Encryption key lives in the message envelope. Clients may choose to set `content_type` to `application/octet-stream` for stronger metadata privacy.

---

## Domain 3: Social Graph

```sql
CREATE TABLE follows (
    follower_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followed_id),
    CHECK (follower_id <> followed_id)
);
CREATE INDEX idx_follows_followed ON follows (followed_id);

CREATE TABLE blocks (
    blocker_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_blocks_blocked ON blocks (blocked_id);

CREATE TABLE mutes (
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, muted_id),
    CHECK (user_id <> muted_id)
);
```

---

## Domain 4: Events

Split into domain events (immutable business facts) and outbox (integration queue).

### domain_events

Immutable business facts. Never modified. Source of audit truth.

```sql
CREATE TABLE domain_events (
    id              uuid PRIMARY KEY,
    event_type      varchar(100) NOT NULL,
    aggregate_type  varchar(50) NOT NULL,
    aggregate_id    uuid NOT NULL,
    payload         jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_domain_events_aggregate ON domain_events (aggregate_type, aggregate_id, created_at);
```

### outbox

Integration queue for async processing (notifications, search indexing, push).

```sql
CREATE TABLE outbox (
    id              uuid PRIMARY KEY,
    event_type      varchar(100) NOT NULL,
    payload         jsonb NOT NULL,
    status          varchar(20) NOT NULL DEFAULT 'pending',
    attempt_count   smallint NOT NULL DEFAULT 0,
    last_error      text,
    available_at    timestamptz NOT NULL DEFAULT now(),
    processed_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead'))
);

CREATE INDEX idx_outbox_pending ON outbox (available_at)
    WHERE status IN ('pending', 'failed');
```

---

## Message Ordering

Canonical message order is **`ORDER BY id DESC`** (UUIDv7 is time-sortable).

`server_ts` is kept for observability and future partitioning, but pagination cursors use `id`:

```sql
-- Cursor-based pagination (not offset)
SELECT * FROM messages
WHERE conversation_id = $1 AND id < $2
ORDER BY id DESC
LIMIT 50;
```

---

## Migration Strategy

### Separate databases

v2 Rust server runs on `eulesia_v2`. No shared tables with v1.

### What carries over

| v1 Table                                | v2 Treatment                                          |
| --------------------------------------- | ----------------------------------------------------- |
| `users`                                 | Migrate core fields. No password migration (re-auth). |
| `municipalities`, `locations`, `places` | Copy as-is.                                           |
| `threads`, `comments`, `votes`          | Copy as-is (public content).                          |
| `clubs`, `club_*`                       | Copy as-is.                                           |
| `conversations`, `direct_messages`      | **Do not migrate.** E2EE starts fresh.                |
| `content_reports`, `moderation_*`       | Copy for compliance continuity.                       |
| `sessions`, `invite_codes`, `waitlist`  | Do not migrate (ephemeral).                           |

### Phases

1. **v2 empty schema** — deploy migrations, no data
2. **v2 identity** — users register/login on v2
3. **v2 messaging** — E2EE conversations start fresh
4. **v1 data import** — batch-copy public content, geo, moderation
5. **v1 sunset** — redirect all traffic to v2

---

## Query Conventions (sqlx)

### Why sqlx

- Compile-time checked SQL against the actual schema
- No ORM abstraction — real SQL
- Async with tokio, native PostgreSQL
- Migrations embedded in the binary

### Transaction boundaries

- **Single entity writes**: no transaction needed
- **Multi-entity writes**: always transactional
- **Membership change + epoch rotation + membership_event**: always transactional
- **Message send + device queue fan-out**: always transactional

### ID generation

All IDs generated in Rust via `uuid::Uuid::now_v7()`. Database columns have no DEFAULT — app always provides the ID.

---

## Soft Delete Policy

| Category           | Policy                     | Tables                                                                         |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------ |
| User-facing data   | Soft delete (`deleted_at`) | `users`, `conversations`, `messages` (via `message_redactions`)                |
| Public content     | Soft delete                | threads, comments, clubs (when migrated)                                       |
| Ephemeral material | Hard delete                | `sessions`, `one_time_pre_keys` (consumed), `message_device_queue` (delivered) |
| Auth artifacts     | Hard delete or TTL         | `sessions`, `magic_links`, pending registrations                               |
| Audit/events       | Never delete               | `domain_events`, `membership_events`, `conversation_epochs`                    |

---

## Notifications

Outbox-driven notification delivery across four channels (in-app, WebSocket,
Web Push, FCM). See `docs/v2-migration-scope.md` for the full architecture.

### notifications

Persistent notification history per user.

```sql
CREATE TABLE notifications (
    id              uuid PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type      varchar(50) NOT NULL,
    title           varchar(255) NOT NULL,
    body            text,
    link            varchar(500),
    read            boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CHECK (event_type IN (
        'reply', 'thread_reply', 'mention', 'direct_message',
        'room_invite', 'club_invitation', 'club_invitation_accepted',
        'sanction', 'sanction_revoked', 'appeal_response',
        'follow', 'system'
    ))
);

CREATE INDEX idx_notifications_user_unread ON notifications (user_id, created_at);
CREATE INDEX idx_notifications_user_unread_partial ON notifications (user_id) WHERE read = false;
```

### push_subscriptions

Web Push VAPID endpoints (per-browser).

```sql
CREATE TABLE push_subscriptions (
    id              uuid PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint        text NOT NULL UNIQUE,
    p256dh          text NOT NULL,
    auth            text NOT NULL,
    user_agent      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subs_user ON push_subscriptions (user_id);
```

### devices.fcm_token

FCM device token added as a nullable column on the existing `devices` table.
A device is a device — the same entity handles E2EE keys and push delivery.

```sql
ALTER TABLE devices ADD COLUMN fcm_token varchar(500);
```

### Delivery flow

Notification events are written to the `outbox` table (already in schema).
A background worker processes them:

1. INSERT into `notifications` (persistent history)
2. WebSocket push to connected device sessions
3. Web Push POST to VAPID endpoints from `push_subscriptions`
4. FCM HTTP v1 POST using `devices.fcm_token`
5. Mark outbox entry completed (or retry with backoff)

### thread_views

Per-user view deduplication for threads.

```sql
CREATE TABLE thread_views (
    thread_id   uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, user_id)
);
```

View count is incremented only on the first view per user per thread
(INSERT ON CONFLICT DO NOTHING + conditional increment).

---

## Future: Not Yet Implemented

These are architecturally reserved:

- **`conversation_devices`** — per-device group membership for E2EE key entitlement
- **`message_receipts`** — richer read/delivery receipt semantics
- **Table partitioning** — `messages` by `server_ts` when exceeding ~100M rows
