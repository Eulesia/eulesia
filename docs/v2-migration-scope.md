# v2 Migration Scope

What the Rust v2 backend replaces from the current Node.js v1 API, and how
the transition works.

## Replacement Summary

### Phase 1 — Core (current PR)

These domains have v2 schema and entity models. The Rust server handles
them natively once the API handlers are implemented.

| Domain          | v1 (Node/Express)                                         | v2 (Rust/axum)                                                                           | Status   |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| Auth & identity | Cookie sessions, magic links, Argon2, FTN/EUDI OIDC       | `users`, `devices`, `sessions` + E2EE device key management                              | API done |
| Messaging       | Plaintext `directMessages` table                          | Server-blind E2EE via `conversations`, `memberships`, `messages`, `message_device_queue` | API done |
| Social graph    | Follows (blocks/mutes tables exist unused)                | `follows`, `blocks`, `mutes` with full FK enforcement                                    | API done |
| Public content  | `threads`, `comments`, votes, tags, bookmarks (12 tables) | Same tables, unified schema (no club/room duplication)                                   | API done |
| Moderation/DSA  | Reports, actions, sanctions, appeals                      | Same structure, FK-enforced audit trail                                                  | API done |
| Geo             | `municipalities`, `locations`, `places`                   | Same structure                                                                           | API done |
| Notifications   | 4-channel fire-and-forget from request handlers           | Outbox-driven async delivery with retry semantics                                        | API done |

### Phase 2 — Features to absorb

| Feature       | v1 implementation                                                    | v2 approach                                                                                   |
| ------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Clubs & Rooms | 12 separate tables (`club_threads`, `club_comments`, `room_*`, etc.) | Merge into unified `conversations` with type='group'/'channel'. Eliminates table duplication. |
| Search        | Meilisearch via Node service + 5-minute sync                         | Rust Meilisearch client. Index sync via outbox events.                                        |
| Real-time     | Socket.IO                                                            | axum WebSocket. E2EE messages deliver encrypted envelopes per-device, not broadcast.          |
| File uploads  | Express + multer                                                     | axum multipart, S3/storage backend                                                            |
| Link previews | Express route + OG scraping                                          | axum handler                                                                                  |
| Admin panel   | Separate admin auth + routes                                         | Same API, role-gated endpoints                                                                |

### Phase 3 — v1 features to carry forward (not yet designed)

| Feature               | v1 implementation                               | Notes                       |
| --------------------- | ----------------------------------------------- | --------------------------- |
| Waitlist/invite codes | Gated registration with approval workflow       | Schema needed, low priority |
| EUDI Wallet           | Custom OIDC integration for EU Digital Identity | Part of epic-03 (identity)  |
| Trending/discovery    | CVS score calculation, cron-based cache refresh | Part of epic-09 (search)    |
| Rate limiting         | Express middleware, per-endpoint                | axum Tower middleware       |
| OG tags / sitemap     | Express routes for SEO bots                     | axum handlers               |

### What stays Node (initially)

| Component                      | Reason                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Content scrapers (11 services) | Batch jobs, not latency-sensitive. Can call the Rust API or write to v2 DB directly. Mistral AI integration is complex and decoupled. |
| Email sending                  | Thin integration. Triggered via outbox pattern — the Rust server writes outbox events, a worker (Node or Rust) sends emails.          |

These can be migrated to Rust later but are not on the critical path.

## Notification Architecture

### v1 (current)

Fire-and-forget from request handlers:

```
Event (reply, DM, sanction, etc.)
  → notify(userId, type, title, body, link)
    ├─ INSERT into notifications table
    ├─ Socket.IO emit to user:{userId}
    ├─ Web Push via VAPID (web-push npm)
    └─ FCM via firebase-admin SDK (native iOS/Android)
```

Problems: no retry on failure, FCM SDK is heavy, notification delivery
blocks the API response (fire-and-forget but still allocates).

### v2 (planned)

Outbox-driven async delivery:

```
API handler (e.g., message sent)
  → INSERT into outbox { event_type: "notification", payload }
  → return 200 immediately

Outbox worker (background loop):
  → poll outbox WHERE status = 'pending'
  → for each event:
      ├─ INSERT into notifications table (persistent history)
      ├─ WebSocket push to connected sessions
      ├─ Web Push POST to VAPID endpoints (push_subscriptions)
      ├─ FCM HTTP v1 API POST (device fcm_token)
      └─ UPDATE outbox SET status = 'completed'
  → on failure: increment attempt_count, backoff via available_at
```

### FCM without the SDK

Firebase Cloud Messaging's HTTP v1 API is a single REST endpoint:

```
POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send
Authorization: Bearer {oauth2_token}

{ "message": { "token": "...", "notification": { "title": "...", "body": "..." } } }
```

Auth uses a Google service account JWT exchanged for an OAuth2 token.
This is ~100 lines of Rust (`reqwest` + `jsonwebtoken`) — no SDK needed.

### Web Push without a library

VAPID Web Push is three steps:

1. Sign a JWT with the VAPID private key
2. Encrypt the payload with ECDH (p256dh + auth from the subscription)
3. POST to the subscription endpoint with the encrypted payload

This is ~200 lines of Rust or use the `web-push` crate.

### Schema additions

| Table                | Purpose                                  | Notes                                           |
| -------------------- | ---------------------------------------- | ----------------------------------------------- |
| `notifications`      | Persistent notification history per user | Type, title, body, link, read status            |
| `push_subscriptions` | Web Push VAPID endpoints                 | Per-browser: endpoint, p256dh, auth keys        |
| `devices.fcm_token`  | FCM device token                         | Added as nullable column — a device is a device |

The `outbox` table (already in schema) handles delivery queueing.

## Database Migration Path

### Separate databases

v2 runs on `eulesia_v2`. No shared tables with v1.

### Data migration phases

1. **v2 empty schema** — deploy migrations, no data
2. **v2 identity** — users register/login on v2 (re-auth required, no password migration)
3. **v2 messaging** — E2EE conversations start fresh (no plaintext migration)
4. **v1 content import** — batch-copy: public content, geo, moderation history
5. **v1 sunset** — redirect all traffic to v2

### What carries over from v1

| v1 data                                 | v2 treatment                                       |
| --------------------------------------- | -------------------------------------------------- |
| `users` (core fields)                   | Migrate. Users must re-authenticate (new session). |
| `municipalities`, `locations`, `places` | Copy as-is.                                        |
| `threads`, `comments`, `votes`, `tags`  | Copy as-is (public content).                       |
| `clubs`, `club_*`                       | Restructure into conversations with type='group'.  |
| `conversations`, `direct_messages`      | Do not migrate. E2EE starts fresh.                 |
| `content_reports`, `moderation_*`       | Copy for DSA compliance continuity.                |
| `sessions`, `invite_codes`, `waitlist`  | Do not migrate (ephemeral).                        |
| `notifications`, `push_subscriptions`   | Do not migrate. Users re-subscribe.                |
