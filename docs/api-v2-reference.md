# Eulesia v2 API Reference

Base URL: `/api/v2`

## Authentication

All authenticated endpoints accept either:

- **Session cookie**: `session=<token>` (set by login/register responses)
- **Bearer token**: `Authorization: Bearer <token>`

Endpoints marked **Auth: optional** return additional per-user data (votes,
bookmarks) when authenticated, but work for anonymous requests too.

## Common Error Responses

| Status | Meaning               | Body shape                            |
| ------ | --------------------- | ------------------------------------- |
| 400    | Bad request           | `{ "error": "<validation message>" }` |
| 401    | Not authenticated     | `{ "error": "unauthorized" }`         |
| 403    | Forbidden             | `{ "error": "forbidden" }`            |
| 404    | Not found             | `{ "error": "<resource> not found" }` |
| 409    | Conflict              | `{ "error": "<conflict message>" }`   |
| 500    | Internal server error | `{ "error": "<message>" }`            |

## Pagination Patterns

Two patterns are used:

**Offset-based** (public content, social lists, bookmarks):

```
?offset=0&limit=20
```

Response includes `{ data: [...], total: N, offset: N, limit: N }`.
Default limit is 20, maximum is 100.

**Cursor-based** (messages):

```
?before=<uuid>&limit=50
```

Returns messages with `id < before`, ordered by `id DESC` (UUIDv7 is
time-sortable). Default limit is 50, maximum is 100.

## Ciphertext Encoding

All ciphertext fields in request and response bodies use **base64** encoding.
Both standard (RFC 4648) and URL-safe-no-pad variants are accepted on input.
Responses use standard base64 for message ciphertext and URL-safe-no-pad for
key material.

---

## Health

### GET /health

Liveness probe. No auth, no database call.

**Auth**: none

**Response** `200`:

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

### GET /ready

Readiness probe. Checks database connectivity.

**Auth**: none

**Response** `200`:

```json
{
  "status": "ready",
  "database": true
}
```

**Error** `500` if the database is not reachable.

---

## Auth

### POST /auth/register

Create a new user account. Sets a `session` cookie and returns a bearer token.

**Auth**: none

**Request body**:

```json
{
  "username": "string (min 3 chars)",
  "password": "string",
  "name": "string",
  "email": "string | null"
}
```

**Response** `200`:

```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "name": "string",
    "avatar_url": "string | null",
    "role": "string"
  },
  "token": "string",
  "expires_at": "ISO 8601 datetime"
}
```

Sets `session` cookie (HttpOnly, SameSite=Lax).

### POST /auth/login

Authenticate with username and password.

**Auth**: none

**Request body**:

```json
{
  "username": "string",
  "password": "string"
}
```

**Response** `200`: same shape as register.

### POST /auth/logout

Revoke the current session. Clears the session cookie.

**Auth**: required

**Response** `200`: empty body. Cookie removed.

### GET /auth/me

Return the authenticated user's profile.

**Auth**: required

**Response** `200`:

```json
{
  "id": "uuid",
  "username": "string",
  "name": "string",
  "avatar_url": "string | null",
  "role": "string"
}
```

---

## Devices (E2EE Key Management)

### POST /devices

Register a new device shell. Matrix device keys and one-time keys are uploaded
afterward through the Matrix-specific key endpoints. Maximum 10 active devices
per user.

**Auth**: required

**Request body**:

```json
{
  "display_name": "string | null",
  "platform": "web | android | ios | desktop",
  "pairing_code": "string | null"
}
```

**Response** `200`:

```json
{
  "id": "uuid",
  "display_name": "string | null",
  "platform": "string",
  "created_at": "ISO 8601 datetime"
}
```

### GET /devices

List the authenticated user's active (non-revoked) devices.

**Auth**: required

**Response** `200`:

```json
[
  {
    "id": "uuid",
    "display_name": "string | null",
    "platform": "string",
    "created_at": "ISO 8601 datetime"
  }
]
```

### DELETE /devices/{id}

Revoke a device. Also revokes all sessions bound to the device.

**Auth**: required (must own the device)

**Response** `200`: empty body.

### Matrix key endpoints

The active E2EE runtime uses:

- `POST /devices/{id}/matrix/keys/upload`
- `POST /devices/matrix/keys/query`
- `POST /devices/matrix/keys/claim`

These endpoints carry Matrix-compatible device keys, signed one-time keys, and
fallback keys for the browser `OlmMachine`.

---

## Agora (Public Content)

### GET /agora/threads

List threads with filtering, sorting, and pagination. Threads from blocked
users (in either direction) are excluded for authenticated callers.

**Auth**: optional

**Query parameters**:

- `scope` (string, optional) -- `local`, `national`, or `european`
- `municipality_id` (uuid, optional) -- filter by municipality
- `tag` (string, optional) -- filter by tag
- `sort` (string, optional) -- `recent` (default), `best`, `controversial`
- `offset` (integer, default 0)
- `limit` (integer, default 20, max 100)

**Response** `200`:

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "string",
      "content": "string",
      "content_html": "string | null",
      "scope": "local | national | european",
      "author": {
        "id": "uuid",
        "username": "string",
        "name": "string",
        "avatar_url": "string | null",
        "role": "string"
      },
      "tags": ["string"],
      "reply_count": 0,
      "score": 0,
      "view_count": 0,
      "user_vote": -1 | 0 | 1 | null,
      "is_bookmarked": false,
      "is_pinned": false,
      "is_locked": false,
      "created_at": "ISO 8601 datetime",
      "updated_at": "ISO 8601 datetime"
    }
  ],
  "total": 42,
  "offset": 0,
  "limit": 20
}
```

`user_vote` and `is_bookmarked` are only populated for authenticated callers.

### GET /agora/threads/{id}

Get a single thread with its comments. Returns the thread and a paginated
comment list.

**Auth**: optional

**Query parameters** (for comments):

- `sort` (string, optional) -- `best` (default), `recent`, `controversial`
- `offset` (integer, default 0)
- `limit` (integer, default 20, max 100)

**Response** `200`:

```json
{
  "thread": { "...ThreadResponse" },
  "comments": {
    "data": [
      {
        "id": "uuid",
        "thread_id": "uuid",
        "parent_id": "uuid | null",
        "author": { "...AuthorSummary" },
        "content": "string",
        "content_html": "string | null",
        "depth": 0,
        "score": 0,
        "user_vote": -1 | 0 | 1 | null,
        "created_at": "ISO 8601 datetime",
        "updated_at": "ISO 8601 datetime"
      }
    ],
    "total": 5,
    "offset": 0,
    "limit": 20
  }
}
```

### POST /agora/threads

Create a new thread.

**Auth**: required

**Request body**:

```json
{
  "title": "string (non-empty)",
  "content": "string (non-empty)",
  "scope": "local | national | european",
  "municipality_id": "uuid | null (required when scope=local)",
  "tags": ["string"] | null,
  "language": "string | null"
}
```

**Response** `200`: `ThreadResponse`

### PATCH /agora/threads/{id}

Update a thread. Only the author may update.

**Auth**: required (author only)

**Request body** (all fields optional):

```json
{
  "title": "string",
  "content": "string",
  "tags": ["string"]
}
```

If `tags` is provided, the full tag set is replaced.

**Response** `200`: `ThreadResponse`

### DELETE /agora/threads/{id}

Soft-delete a thread. Allowed for the author or a moderator.

**Auth**: required (author or moderator)

**Response** `200`: empty body.

### POST /agora/threads/{id}/view

Record a thread view. View count is incremented at most once per user per
thread (deduplicated via `thread_views` table).

**Auth**: required

**Response** `200`: empty body.

### POST /agora/threads/{id}/comments

Create a comment on a thread. Nested replies are supported via `parent_id`.
Fails if the thread is locked.

**Auth**: required

**Request body**:

```json
{
  "content": "string (non-empty)",
  "parent_id": "uuid | null"
}
```

**Response** `200`: `CommentResponse`

### PATCH /agora/comments/{id}

Update a comment. Only the author may update.

**Auth**: required (author only)

**Request body**:

```json
{
  "content": "string (non-empty)"
}
```

**Response** `200`: `CommentResponse`

### DELETE /agora/comments/{id}

Soft-delete a comment. Allowed for the author or a moderator. Decrements the
parent thread's reply count.

**Auth**: required (author or moderator)

**Response** `200`: empty body.

### POST /agora/threads/{id}/vote

Vote on a thread. Upvote (+1), downvote (-1), or clear (0). Idempotent.

**Auth**: required

**Request body**:

```json
{
  "value": -1 | 0 | 1
}
```

**Response** `200`:

```json
{
  "score": 42,
  "user_vote": 1
}
```

### POST /agora/comments/{id}/vote

Vote on a comment. Same semantics as thread voting.

**Auth**: required

**Request body**:

```json
{
  "value": -1 | 0 | 1
}
```

**Response** `200`:

```json
{
  "score": 7,
  "user_vote": -1
}
```

### GET /agora/tags

List all tags with their thread counts. Returns up to 100 tags.

**Auth**: none

**Response** `200`:

```json
[
  { "tag": "climate", "count": 15 },
  { "tag": "housing", "count": 8 }
]
```

### GET /agora/tags/{tag}

List threads for a specific tag. Supports the same query parameters as
`GET /agora/threads` (scope, municipality_id, sort, offset, limit).

**Auth**: optional

**Response** `200`: `ThreadListResponse` (same shape as `GET /agora/threads`)

---

## Social Graph

### POST /social/follow/{user_id}

Follow a user. Idempotent (no-op if already following). Fails if either user
has blocked the other.

**Auth**: required

**Response** `200`: empty body.

### DELETE /social/follow/{user_id}

Unfollow a user. Idempotent.

**Auth**: required

**Response** `200`: empty body.

### GET /social/followers

List the authenticated user's followers with pagination.

**Auth**: required

**Query parameters**:

- `offset` (integer, default 0)
- `limit` (integer, default 50)

**Response** `200`:

```json
{
  "data": [
    {
      "id": "uuid",
      "username": "string",
      "name": "string",
      "avatar_url": "string | null"
    }
  ],
  "total": 12
}
```

### GET /social/following

List users the authenticated user follows. Same shape as followers.

**Auth**: required

**Query parameters**:

- `offset` (integer, default 0)
- `limit` (integer, default 50)

**Response** `200`: same as `GET /social/followers`

### POST /social/block/{user_id}

Block a user. Idempotent. Automatically removes follows in both directions.

**Auth**: required

**Response** `200`: empty body.

### DELETE /social/block/{user_id}

Unblock a user. Idempotent.

**Auth**: required

**Response** `200`: empty body.

### POST /social/mute/{user_id}

Mute a user. Idempotent. Target user must exist.

**Auth**: required

**Response** `200`: empty body.

### DELETE /social/mute/{user_id}

Unmute a user. Idempotent.

**Auth**: required

**Response** `200`: empty body.

---

## Bookmarks

### POST /bookmarks

Bookmark a thread. Idempotent (no-op if already bookmarked). Thread must exist.

**Auth**: required

**Request body**:

```json
{
  "thread_id": "uuid"
}
```

**Response** `200`: empty body.

### GET /bookmarks

List the authenticated user's bookmarks with pagination.

**Auth**: required

**Query parameters**:

- `offset` (integer, default 0)
- `limit` (integer, default 50)

**Response** `200`:

```json
{
  "data": [
    {
      "thread_id": "uuid",
      "created_at": "ISO 8601 datetime"
    }
  ],
  "total": 5
}
```

### DELETE /bookmarks/{thread_id}

Remove a bookmark. Idempotent.

**Auth**: required

**Response** `200`: empty body.

---

## Messaging (E2EE Conversations)

All messaging endpoints require authentication. Conversation access is
verified through active membership.

### POST /conversations

Create a new conversation.

**Auth**: required

**Request body**:

```json
{
  "conversation_type": "direct | group",
  "name": "string | null (group only)",
  "description": "string | null (group only)",
  "members": ["uuid"]
}
```

For **direct** conversations:

- `members` must contain exactly 1 user ID (the other participant).
- If a DM already exists between the two users, it is returned (idempotent).
- `name` and `description` are ignored.

For **group** conversations:

- The caller becomes the admin (owner).
- `members` lists the initial invitees (caller is added automatically).

Both types start at epoch 0 with E2EE encryption.

**Response** `200`:

```json
{
  "id": "uuid",
  "conversation_type": "direct | group",
  "encryption": "e2ee",
  "name": "string | null",
  "description": "string | null",
  "creator_id": "uuid | null",
  "current_epoch": 0,
  "members": [
    {
      "user_id": "uuid",
      "role": "member | admin",
      "joined_epoch": 0
    }
  ],
  "created_at": "ISO 8601 datetime",
  "updated_at": "ISO 8601 datetime"
}
```

### GET /conversations

List the authenticated user's conversations (all conversations where they
have an active membership).

**Auth**: required

**Response** `200`:

```json
[
  {
    "id": "uuid",
    "conversation_type": "direct | group",
    "name": "string | null",
    "current_epoch": 3,
    "created_at": "ISO 8601 datetime"
  }
]
```

### GET /conversations/{id}

Get a single conversation with its members.

**Auth**: required (active member)

**Response** `200`: `ConversationResponse` (same as create response)

### PATCH /conversations/{id}

Update a group conversation's name or description. Only group conversations
can be updated, and only by an admin.

**Auth**: required (owner)

**Request body** (all fields optional):

```json
{
  "name": "string",
  "description": "string"
}
```

**Response** `200`: `ConversationResponse`

### DELETE /conversations/{id}

Soft-delete a conversation. Only the creator or an admin may delete.

**Auth**: required (creator or admin)

**Response** `200`: empty body.

### GET /conversations/{id}/epochs

List epoch rotation history for a conversation.

**Auth**: required (active member)

**Response** `200`:

```json
[
  {
    "epoch": 0,
    "rotated_by": "uuid | null",
    "reason": "created | member_added | member_removed | key_compromise | scheduled",
    "created_at": "ISO 8601 datetime"
  }
]
```

### POST /conversations/{id}/messages

Send a message to a conversation. Requires a device-bound session
(`device_id` in the auth token).

**Auth**: required (active member, device-bound session)

**Request body**:

For **direct** conversations:

```json
{
  "message_type": "text | media | system | reaction | redaction",
  "device_ciphertexts": {
    "<device_uuid>": "base64 ciphertext",
    "<device_uuid>": "base64 ciphertext"
  }
}
```

For **group** conversations:

```json
{
  "message_type": "text | media | system | reaction | redaction",
  "ciphertext": "base64 string (sender-key encrypted)"
}
```

Direct messages use per-device encryption: each target device receives its
own ciphertext copy via the delivery queue. Group messages use sender-key
encryption: a single ciphertext is fan-out to all member devices (except
the sender's current device).

**Response** `200`:

```json
{
  "id": "uuid",
  "conversation_id": "uuid",
  "sender_id": "uuid",
  "sender_device_id": "uuid",
  "epoch": 0,
  "ciphertext": "base64 string",
  "message_type": "text",
  "server_ts": "ISO 8601 datetime"
}
```

### GET /conversations/{id}/messages

List messages in a conversation using cursor-based pagination.

**Auth**: required (active member)

**Query parameters**:

- `before` (uuid, optional) -- cursor: return messages with `id < before`
- `limit` (integer, default 50, max 100)

**Response** `200`:

```json
[
  {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "uuid",
    "sender_device_id": "uuid",
    "epoch": 0,
    "ciphertext": "base64 string",
    "message_type": "text",
    "server_ts": "ISO 8601 datetime"
  }
]
```

**DM ciphertext behavior**: For direct conversations, the `ciphertext` field
returns the device-specific ciphertext from `message_device_queue` for the
caller's device (if available). If no device-specific entry exists (e.g., the
queue entry was GC'd), it falls back to `messages.ciphertext` which contains
the sender's device copy. For group conversations, `ciphertext` is always the
sender-key-encrypted message from `messages.ciphertext`.

### POST /conversations/{id}/members

Invite a user to a group conversation. Increments the conversation epoch
(triggering key rotation). Only owners may invite.

**Auth**: required (owner)

**Request body**:

```json
{
  "user_id": "uuid"
}
```

**Response** `200`:

```json
{
  "user_id": "uuid",
  "role": "member",
  "joined_epoch": 3
}
```

Returns `409` if the user is already an active member.

### GET /conversations/{id}/members

List active members of a conversation.

**Auth**: required (active member)

**Response** `200`:

```json
[
  {
    "user_id": "uuid",
    "role": "member | admin",
    "joined_epoch": 0
  }
]
```

### DELETE /conversations/{id}/members/{user_id}

Remove a member from a conversation, or leave the conversation (if
`{user_id}` matches the caller). Increments the conversation epoch.

- Leaving: any member may leave (user_id = self).
- Removing: only admins may remove other members.

**Auth**: required (self to leave, admin to remove others)

**Response** `200`: empty body.

### PATCH /conversations/{id}/members/{user_id}

Change a member's role. Only admins may change roles.

**Auth**: required (owner)

**Request body**:

```json
{
  "role": "member | admin"
}
```

**Response** `200`:

```json
{
  "user_id": "uuid",
  "role": "owner",
  "joined_epoch": 0
}
```

---

## Delivery Queue

Per-device message delivery for E2EE. These endpoints are under `/devices`
but are part of the messaging module.

### GET /devices/queue

Fetch pending (undelivered) messages for the authenticated device.

**Auth**: required (device-bound session)

**Query parameters**:

- `limit` (integer, default 100, max 500)

**Response** `200`:

```json
[
  {
    "message_id": "uuid",
    "ciphertext": "base64 string",
    "enqueued_at": "ISO 8601 datetime"
  }
]
```

### POST /devices/queue/ack

Acknowledge delivery of messages. Marks them as delivered in the queue.
Delivered entries are garbage-collected periodically.

**Auth**: required (device-bound session)

**Request body**:

```json
{
  "deliveries": [{ "message_id": "uuid" }, { "message_id": "uuid" }]
}
```

**Response** `200`:

```json
{
  "acknowledged": 2
}
```

---

## Moderation

### POST /moderation/reports

Submit a content report.

**Auth**: required

**Request body**:

```json
{
  "content_type": "thread|comment",
  "content_id": "uuid",
  "reason": "illegal|harassment|spam|misinformation|other",
  "description": "optional details"
}
```

### GET /moderation/reports

List reports. Moderator only.

**Auth**: required (moderator)
**Query**: `status` (optional: pending|reviewing|resolved|dismissed), `offset`, `limit`

### GET /moderation/reports/{id}

Report detail. Moderator only.

### PATCH /moderation/reports/{id}

Update report status or assign moderator.

**Auth**: required (moderator)

**Request body**:

```json
{
  "status": "reviewing|resolved|dismissed",
  "assigned_to": "uuid (optional)"
}
```

### POST /moderation/sanctions

Issue a sanction. Moderator only.

**Auth**: required (moderator)

**Request body**:

```json
{
  "user_id": "uuid",
  "sanction_type": "warning|suspension|ban",
  "reason": "optional",
  "expires_at": "ISO 8601 (optional)"
}
```

### GET /moderation/sanctions

List all sanctions. Moderator only.

### GET /moderation/sanctions/user/{user_id}

Active sanctions for a user. Moderator only.

### PATCH /moderation/sanctions/{id}/revoke

Revoke a sanction. Moderator only.

### POST /moderation/appeals

Submit an appeal against a sanction.

**Auth**: required

**Request body**:

```json
{
  "sanction_id": "uuid",
  "reason": "appeal justification"
}
```

### GET /moderation/appeals

List appeals. Moderator only.

### PATCH /moderation/appeals/{id}/respond

Respond to an appeal. Moderator only.

**Request body**:

```json
{
  "status": "accepted|rejected",
  "admin_response": "response text"
}
```

---

## User Profiles

### GET /users/{id}

Public user profile.

**Auth**: optional

### PATCH /users/me

Update own profile.

**Auth**: required

**Request body**:

```json
{
  "name": "optional",
  "bio": "optional",
  "avatar_url": "optional",
  "locale": "optional"
}
```

---

## Notifications

### GET /notifications

List user's notifications (paginated, newest first).

**Auth**: required
**Query**: `offset`, `limit`

### GET /notifications/unread-count

Count of unread notifications.

**Auth**: required

### POST /notifications/{id}/read

Mark single notification as read.

### POST /notifications/read-all

Mark all notifications as read.

### DELETE /notifications/{id}

Delete a notification.

### POST /notifications/push/subscribe

Register a Web Push subscription.

**Auth**: required

**Request body**:

```json
{
  "endpoint": "push endpoint URL",
  "p256dh": "ECDH public key",
  "auth": "auth secret"
}
```

### DELETE /notifications/push/subscribe

Unsubscribe from Web Push.

**Auth**: required

**Request body**:

```json
{
  "endpoint": "push endpoint URL"
}
```

---

## Search

### GET /search

Federated search across threads and users.

**Auth**: optional
**Query**: `q` (required), `type` (optional: threads|users), `limit`

### GET /search/health

Meilisearch health check.

---

## WebSocket

### WSS /ws/v2?token=<session_token>

WebSocket connection for real-time updates.

**Auth**: session token in query parameter (device_id optional — sessions without a bound device use session_id as connection key)

**Server->Client messages** (JSON, tagged by `type`):

- `new_message` -- E2EE message envelope
- `notification` -- notification event
- `typing` -- typing indicator
- `presence` -- online/offline status

**Client->Server messages**:

- `typing_start` -- `{ "type": "typing_start", "conversation_id": "uuid" }`
- `typing_stop` -- `{ "type": "typing_stop", "conversation_id": "uuid" }`
- `ping` -- keepalive
