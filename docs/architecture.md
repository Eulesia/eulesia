# Eulesia v2 Architecture

## System Boundary

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (React)                        │
│                                                              │
│  UI rendering, local state, E2EE crypto, offline storage     │
│  Key management, message encrypt/decrypt, contact trust      │
│  Push notification handling, service worker, PWA             │
└────────────────────────────┬─────────────────────────────────┘
                             │ HTTPS / WebSocket
┌────────────────────────────┴─────────────────────────────────┐
│                     Server (Rust / axum)                      │
│                                                              │
│  Authentication, authorization, session management           │
│  Public content CRUD, search indexing, feed generation        │
│  Encrypted message relay (opaque blobs, no decryption)       │
│  Device registration, Matrix key directory                   │
│  Media upload/storage, moderation, admin API                 │
│  Background jobs, notifications, scheduled imports           │
└────────────────────────────┬─────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         PostgreSQL     Meilisearch    Object Store
```

## Server Scope

The server is the **authority for identity, access control, and public content**.
The server is **blind to private message content**.

### Owns

- **Identity**: user accounts, device registration, identity verification (FTN/EUDI)
- **Sessions**: authentication, token issuance, session lifecycle
- **Device registry**: device metadata, Matrix device keys, trust metadata
- **Public content**: agora threads, comments, votes, institutional imports
- **Social graph**: follows, blocks, mutes — enforced server-side
- **Groups**: membership state, role assignments, epoch tracking
- **Message relay**: accept encrypted envelopes, store, deliver — never decrypt
- **Media**: encrypted attachment storage, upload/download, quota enforcement
- **Search**: public content indexing via Meilisearch
- **Moderation**: public content actions, account sanctions, report queue
- **Admin**: separate admin accounts, admin API, audit log
- **Background jobs**: content imports, notifications, scheduled tasks
- **Rate limiting**: per-user, per-endpoint, per-device abuse prevention

### Does Not Own

- Message encryption/decryption
- Private key material (never touches the server)
- Message content indexing or search
- Client-side trust decisions (device verification UX)
- Offline message queue (client manages retry)

## Client Scope

The client is the **authority for cryptographic operations and private content rendering**.

### Owns

- **E2EE crypto**: Matrix Olm/Megolm state, encrypt/decrypt, session management
- **Key storage**: device private keys in secure local storage (IndexedDB/Keychain)
- **Trust UX**: device verification, safety number comparison, trust warnings
- **Message rendering**: decrypt and display private messages
- **Offline support**: local message cache, pending send queue, sync on reconnect
- **Push handling**: receive push, decrypt notification payload, display
- **Local search**: client-side index of decrypted message history
- **Recovery**: recovery key generation, backup prompt, restore flow

### Does Not Own

- Identity verification (delegates to server → FTN/EUDI)
- Access control for public content (server-enforced)
- Message delivery guarantees (server handles store-and-forward)
- Social graph enforcement (server-enforced blocks/mutes)

## Shared Concerns

These cross the boundary and need coordinated design:

| Concern                   | Server                                          | Client                                                 |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| **Device registration**   | Stores device metadata and Matrix key directory | Initializes machine, uploads keys, manages local store |
| **Session establishment** | Serves Matrix key query/claim responses         | Runs Olm session establishment via `OlmMachine`        |
| **Group membership**      | Tracks members, enforces roles                  | Distributes group keys on membership change            |
| **Delivery receipts**     | Confirms storage (plaintext metadata)           | Sends encrypted read receipts                          |
| **Typing indicators**     | Relays ephemeral signals                        | Sends/displays typing state                            |
| **Push notifications**    | Sends push with encrypted payload               | Decrypts and displays                                  |
| **Recovery**              | Validates recovery token                        | Generates recovery key, encrypts key backup            |

## API Surface

### REST API (`/api/v2/`)

All public content and account management. Stateless, JSON request/response.

```
/api/v2/health              GET     Server health
/api/v2/auth/*              POST    Login, register, logout, refresh
/api/v2/devices/*           CRUD    Device registration, Matrix key directory
/api/v2/users/*             CRUD    Profile, settings, identity
/api/v2/threads/*           CRUD    Agora public discussions
/api/v2/comments/*          CRUD    Thread comments
/api/v2/clubs/*             CRUD    Public groups
/api/v2/social/*            CRUD    Follow, block, mute
/api/v2/search/*            GET     Public content search
/api/v2/moderation/*        CRUD    Reports, admin actions
/api/v2/media/*             POST    Encrypted attachment upload
```

### WebSocket (`/ws/v2`)

Realtime message relay and presence. Session-authenticated.

```
→ send_message      Encrypted envelope to relay
← receive_message   Encrypted envelope from sender
→ typing            Typing indicator
← typing            Typing indicator from peer
→ ack               Delivery acknowledgment
← presence          Online/offline status
```

### Admin API (`/admin/v2/`)

Separate auth domain (admin accounts, not user accounts).

```
/admin/v2/users/*           User management, sanctions
/admin/v2/reports/*         Report queue, resolution
/admin/v2/content/*         Public content moderation
/admin/v2/audit/*           Audit log queries
/admin/v2/settings/*        Site configuration
```

## Module Boundaries (Server)

```
crates/
├── server/              Main binary — axum server, config, startup
├── api/                 REST route handlers, request/response types
├── ws/                  WebSocket connection manager, message relay
├── auth/                Authentication, sessions, device verification
├── db/                  Database access layer, migrations, queries
├── crypto/              Server-side crypto (hashing, tokens — NOT E2EE)
├── search/              Meilisearch integration
├── jobs/                Background job runner, outbox processing
├── moderation/          Report handling, sanctions, audit
└── common/              Shared types, errors, config
```

Each crate exposes a trait-based interface. Dependencies flow inward:
`server` → `api`/`ws` → `auth`/`db`/`search`/`jobs` → `common`

## Data Flow

### Public Content (server-visible)

```
Client → REST API → Validation → DB Write → Search Index → Response
                                          → Notification Jobs
```

### Private Message (server-blind)

```
Client → Encrypt(plaintext) → WebSocket → Server stores opaque blob
                                        → Relay to recipient devices
Recipient ← WebSocket ← Opaque blob → Decrypt(ciphertext) → Display
```

### Device Registration

```
Client → POST /api/v2/devices (register device shell)
       → Initialize Matrix machine for device ID
       → Upload Matrix device keys / one-time keys
       → Other clients query and claim Matrix keys
```

## Technology Stack

| Layer      | Technology                                         |
| ---------- | -------------------------------------------------- |
| Server     | Rust, axum, tokio                                  |
| Database   | PostgreSQL 16, sqlx (compile-time checked queries) |
| Search     | Meilisearch                                        |
| Realtime   | WebSocket via axum                                 |
| Client     | React 19, TypeScript, Vite                         |
| E2EE       | matrix-sdk-crypto-wasm / vodozemac                 |
| Mobile     | Capacitor (iOS/Android)                            |
| Deployment | NixOS, systemd, Traefik                            |
| CI         | GitHub Actions, Nix flake checks                   |

## Deployment Model

The Rust server is the sole backend:

```
                    Traefik (:443)
                    ├── /api/v1/*  → Rust server (:3002)
                    ├── /ws/v2     → Rust server (:3002)
                    └── /*         → nginx → Frontend static
```
