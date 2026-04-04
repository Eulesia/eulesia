---
name: rust-code-style
description: >
  Opinionated Rust code style, architecture, and review guide for the Eulesia
  v2 server. Use this skill whenever reviewing, writing, refactoring, or
  designing Rust code in `crates/`. Triggers include: Rust code review,
  "review this module", "refactor this function", "is this idiomatic Rust",
  architectural design, writing new crates or modules, or any request
  involving Rust code quality. Also use when the user asks about error
  handling strategy, trait design, async patterns, or performance.
---

# Rust Code Style Guide

An opinionated style guide for the Eulesia v2 Rust server. These patterns
prioritize **correctness enforced by types**, **performance without
sacrificing clarity**, and **errors as domain vocabulary**.

## When to use this skill

- **Code review**: Score and critique Rust modules. See `rust/review-rubric.md`.
- **Refactoring**: Decompose large functions, tighten types, flatten error handling.
  See `rust/refactoring-patterns.md`.
- **New code**: Design crates, error types, trait hierarchies, async boundaries.
  See `rust/architecture.md`.
- **Performance**: Allocation discipline, hot/cold path separation, benchmarking.
  See `rust/performance.md`.

Always read the relevant reference file before responding. Multiple may apply.

## Eulesia-specific conventions

### Workspace structure

```
crates/
├── common/     Shared types (Id, UserId, DeviceId, Platform), error types
├── db/         sea-orm entities, migrations, repository layer
├── auth/       Authentication, sessions, password hashing, middleware
├── api/        axum route handlers, request/response types
├── jobs/       Background workers (outbox processor)
├── notify/     Notification dispatch (DB, FCM, Web Push channels)
├── ws/         WebSocket handler + DashMap connection registry
├── search/     Meilisearch client, index definitions, outbox sync
└── server/     Binary: config, logging, startup, graceful shutdown
```

Dependencies flow inward: `server` → `api`/`ws` → `auth`/`db`/`notify`/`search` → `common`.
`common` has zero IO dependencies.

### Auth middleware

Session tokens extracted from `Authorization: Bearer` header or `session`
cookie. The middleware populates `AuthUser` in request extensions.
Routes that require auth use the `AuthUser` extractor (returns 401 if missing).
Routes that don't need auth simply don't extract it.

```rust
// Requires auth — 401 if no session
async fn me(auth: AuthUser, State(state): State<AppState>) -> Result<...>

// No auth required — middleware passes through
async fn health() -> Json<HealthResponse>
```

### Lint policy

Workspace-level lints enforced in `Cargo.toml`:

- `clippy::all` = deny
- `clippy::pedantic` = warn
- `clippy::nursery` = warn
- `unsafe_code` = forbid

All code must pass `cargo clippy --all-targets -- -D warnings`.

### IDs and timestamps

All entity IDs are `UUIDv7` (time-sortable) via `eulesia_common::types::Id`.
All timestamps are `chrono::DateTime<Utc>` via `eulesia_common::types::Timestamp`.

### Error handling

- `eulesia_common::error::ApiError` for HTTP-facing errors with `IntoResponse`
- `thiserror` for domain-specific error enums in each crate
- `anyhow` only in the `server` binary (main.rs)
- See the review rubric for detailed error handling rules

## Core principles (always in context)

### 1. Newtype everything at boundaries

Primitive types at API boundaries are bugs waiting to happen.

```rust
// BAD: which uuid is which?
fn get_device(user_id: Uuid, device_id: Uuid) -> Result<Device, ApiError>

// GOOD: newtypes make the compiler enforce correctness
fn get_device(user_id: UserId, device_id: DeviceId) -> Result<Device, ApiError>
```

**Threshold**: Any public function with 2+ parameters of the same type
gets newtypes. Internal helpers are exempt if the call site is obvious.

### 2. Error types are domain vocabulary

```rust
// BAD: caller can't match on failure modes
fn register_device(req: &DeviceRegistration) -> anyhow::Result<Device>

// GOOD: caller can handle each failure distinctly
#[derive(Debug, thiserror::Error)]
pub enum DeviceError {
    #[error("device limit exceeded: {current}/{max} for user {user_id}")]
    LimitExceeded { user_id: Id, current: u32, max: u32 },

    #[error("duplicate identity key for user {user_id}")]
    DuplicateKey { user_id: Id },

    #[error("database error: {context}")]
    Database { context: &'static str, source: sqlx::Error },
}
```

**Rules**:

- `thiserror` for library crates, `anyhow` only in the server binary
- Error variants name the failure mode, not the implementation detail
- Include enough context to diagnose without a debugger
- Use `#[from]` sparingly — only when the mapping is truly 1:1

### 3. Make illegal states unrepresentable

Use the type system to eliminate runtime invariant checks.

```rust
// BAD: runtime invariant
pub struct Session {
    pub user_id: Id,
    pub device_id: Option<Id>,    // Some after device binding... right?
    pub verified_at: Option<Timestamp>,  // Some after verification... hopefully?
}

// GOOD: type enforces the state machine
pub enum Session {
    Unverified { user_id: Id, token_hash: String },
    Verified { user_id: Id, device_id: Id, verified_at: Timestamp },
}
```

### 4. Own at the core, borrow at the edge

Core data structures own their data. API boundaries borrow.

```rust
// Core domain type: owns everything, no lifetimes
pub struct User {
    pub id: Id,
    pub username: String,
    pub name: String,
}

// API response: borrows from the domain type
pub fn user_response(user: &User) -> Json<UserResponse> { ... }
```

### 5. Separate construction from use

Complex structs get builders. Configuration flows through a typed pipeline.

```rust
let config = ServerConfig::builder()
    .host("127.0.0.1")
    .port(3002)
    .database_url("postgresql:///eulesia")
    .build()?;  // validates invariants
```

4+ fields with defaults → builder. Builder's `build()` returns `Result`.

### 6. Server blindness for E2EE

The server never has access to private key material or decrypted message
content. Encrypted data is `Vec<u8>` (opaque blob) at the server level.

```rust
// Server sees this:
pub struct EncryptedEnvelope {
    pub sender_device_id: DeviceId,
    pub recipient_device_id: DeviceId,
    pub ciphertext: Vec<u8>,  // opaque — server cannot interpret
    pub sent_at: Timestamp,
}

// Server does NOT have:
// - Decryption keys
// - Plaintext content
// - Message content types
```
