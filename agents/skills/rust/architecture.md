# Architecture Patterns

Crate structure, module design, trait hierarchies, error handling, async
patterns for the Eulesia v2 Rust server.

## Crate organization

### Workspace layout

```
crates/
├── common/     Domain types (Id, Timestamp), error hierarchy — zero IO deps
├── db/         sqlx pool, migrations, query functions — depends on common
├── auth/       Sessions, device auth, extractors — depends on common
├── api/        axum route handlers, AppState — depends on auth, db, common
└── server/     Binary: config, logging, startup — depends on api, db
```

**Rules**:

- `common` has zero IO dependencies (no `tokio`, no `sqlx`, no `reqwest`)
- Domain types flow downward: `common` → `db`/`auth` → `api`
- IO types don't flow upward: `api` doesn't export connection pools
- Each crate has a clear single responsibility

### Module file size

- **Target**: 200–400 lines
- **Hard limit**: 500 lines
- **Split signal**: When a module has 3+ structs with `impl` blocks

### Auth and role architecture

Three distinct role systems — never conflate them:

- **`UserRole`** (`eulesia_common::types`): `Citizen`, `Institution`, `Moderator`. Closed enum matching the DB CHECK constraint. Use `role.is_moderator()` for permission gates.
- **Admin accounts**: Separate `admin_accounts` table with dedicated auth. Admin is NOT a `UserRole` variant.
- **Club member roles**: `member`, `moderator`, `admin` — scoped to club membership, unrelated to `UserRole`.

The only role-based permission gate for platform users is `require_moderator()` in the moderation module.

### Visibility

Default to private. Escalate only as needed:

```rust
pub struct AppState { ... }          // public: part of crate API
pub(crate) fn validate(...) { ... }  // crate-internal helper
fn compute_hash(...) { ... }         // module-private
```

Never `pub` a field unless the type is a plain data carrier (DTO, config).

### Re-exports

Crate root (`lib.rs`) re-exports the public API:

```rust
// lib.rs
pub mod error;
pub mod types;
mod internal;

pub use error::ApiError;
pub use types::{Id, Timestamp, Paginated, new_id};
```

## Error handling architecture

### The three-layer pattern

```
server binary     → anyhow::Result  (context-rich, for operators)
API handlers      → ApiError        (HTTP status codes, for clients)
domain logic      → typed errors    (matchable, for callers)
```

### Error conversion strategy

Don't use `#[from]` for cross-layer conversions. Be explicit:

```rust
// In the API handler
async fn register_device(/* ... */) -> Result<Json<Device>, ApiError> {
    let device = auth::register_device(&pool, &req)
        .await
        .map_err(|e| match e {
            DeviceError::LimitExceeded { .. } => ApiError::BadRequest(e.to_string()),
            DeviceError::DuplicateKey { .. } => ApiError::Conflict(e.to_string()),
            DeviceError::Database { .. } => ApiError::Database(e.to_string()),
        })?;
    Ok(Json(device))
}
```

### Context preservation

Always add context when propagating across abstraction boundaries:

```rust
// BAD: raw propagation
let rows = sqlx::query("...").fetch_all(&pool).await?;

// GOOD: context preserved
let rows = sqlx::query("...")
    .fetch_all(&pool)
    .await
    .map_err(|e| UserError::Database { context: "list_active_users", source: e })?;
```

## Sea-ORM patterns

The project uses sea-orm with PostgreSQL. Follow these patterns:

**Repository layer**: Static methods on unit structs. Takes `&DatabaseConnection`,
returns `Result<T, DbErr>`. Repos are in `crates/db/src/repo/`.

```rust
pub struct UserRepo;

impl UserRepo {
    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<users::Model>, DbErr> {
        users::Entity::find_by_id(id).one(db).await
    }
}
```

**ActiveModel construction**: Use `Set` for explicit values, `..Default::default()`
for DB defaults. Always generate IDs in Rust via `new_id()`.

```rust
users::ActiveModel {
    id: Set(new_id()),
    username: Set(username),
    created_at: Set(now),
    ..Default::default()  // DB defaults for optional fields
}
```

**Testing**: Use `MockDatabase` for unit tests. It validates Rust logic
(filter chains, error mapping) but not SQL correctness. Pattern:

```rust
let db = MockDatabase::new(DatabaseBackend::Postgres)
    .append_query_results([[model.clone()]])
    .into_connection();
let result = Repo::find_by_id(&db, id).await.unwrap();
```

**Never `#[from]` broad error types**: `DbErr` and `sqlx::Error` are too broad
for automatic conversion. Always use explicit `map_err` with a context string:

```rust
// BAD: loses context
#[error("database error")]
Database(#[from] sea_orm::DbErr),

// GOOD: preserves call-site context
#[error("database error: {context}")]
Database { context: &'static str, #[source] source: sea_orm::DbErr },

// At call sites:
UserRepo::find_by_id(db, id)
    .await
    .map_err(|e| AuthError::Database { context: "find user", source: e })?;
```

## Handler / service separation

Handlers should be thin — parse, authenticate, delegate, respond. Domain
logic belongs in a service layer.

**Symptoms of a fat handler:**

- Handler owns transaction management, domain branching, and persistence
- Handler exceeds ~50 lines
- `#[allow(clippy::too_many_lines)]` needed
- Same response type built in multiple branches

**Target shape:**

```rust
// Handler: thin
pub async fn send(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    let cmd = SendCommand::new(auth, id, req)?;
    let msg = MessageService::send(&state.db, cmd).await?;
    Ok(Json(MessageResponse::from(msg)))
}

// Service: owns domain logic + transactions
pub struct MessageService;
impl MessageService {
    pub async fn send(db: &DatabaseConnection, cmd: SendCommand) -> Result<SentMessage, SendError> {
        let txn = db.begin().await?;
        // lock, verify, branch, persist, commit
        txn.commit().await?;
        Ok(result)
    }
}
```

**When to extract:**

- Handler has multiple branches sharing persistence logic
- Same handler does auth + validation + domain logic + persistence
- Transaction spans more than one logical operation

### Transaction scope discipline

Lock only what you need, read authoritatively inside the lock:

```rust
// BAD: read outside txn, use inside
let conv = ConversationRepo::find_by_id(&db, id).await?;  // stale
let txn = db.begin().await?;
// conv.current_epoch may be wrong by now

// GOOD: single authoritative read inside lock
let txn = db.begin().await?;
let (conv_type, epoch) = txn.query_one(
    "SELECT type, current_epoch FROM conversations WHERE id = $1 FOR UPDATE", [id]
).await?;
// conv_type and epoch are guaranteed consistent
```

**Rules:**

- If you read a value before the transaction and use it inside, ask: can
  this value change between the read and the commit?
- Membership checks must happen inside the lock (TOCTOU prevention)
- Minimize work under the lock — compute fanout plans, then persist

## Trait design

### When to use traits

- **Abstraction over behavior**: Multiple implementations (database backends, auth providers)
- **Testability**: Mock a dependency in unit tests (`trait Repository`)
- **Plugin boundary**: Runtime-loadable behavior

### When NOT to use traits

- **Single implementation**: Just use the concrete type
- **Type erasure**: Consider an enum first — exhaustive, no allocation

### The repository pattern

```rust
#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn find_by_id(&self, id: Id) -> Result<User, RepositoryError>;
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, RepositoryError>;
    async fn create(&self, user: &NewUser) -> Result<User, RepositoryError>;
}

// Production
pub struct PgUserRepository { pool: PgPool }

// Tests
pub struct InMemoryUserRepository { users: Mutex<Vec<User>> }
```

## Async patterns

### When to use async

- Network IO (HTTP, database, WebSocket)
- Concurrent coordination (waiting on multiple sources)

### When NOT to use async

- CPU-bound computation (use `spawn_blocking`)
- Simple sequential logic
- Cryptographic operations (argon2 hashing — always `spawn_blocking`)

### Tokio conventions

```rust
// Don't hold Mutex across await
let snapshot = {
    let guard = self.state.lock().unwrap();
    guard.clone()
};
self.save(&snapshot).await;

// Structured concurrency with JoinSet
let mut tasks = JoinSet::new();
for device in devices {
    tasks.spawn(deliver_to_device(device, envelope.clone()));
}
while let Some(result) = tasks.join_next().await {
    result??;
}

// Graceful shutdown with signal handling
async fn shutdown_signal() {
    tokio::select! {
        () = ctrl_c() => {},
        () = sigterm() => {},
    }
}
```

### Cancellation safety

Document whether async functions are cancellation-safe:

```rust
/// Relay a message to a device.
///
/// # Cancellation Safety
///
/// This function is NOT cancellation-safe. If cancelled after writing
/// to the device's WebSocket but before updating delivery status, the
/// message will be marked undelivered. The client handles deduplication.
async fn relay_message(&self, device: &Device, msg: &Envelope) -> Result<()>
```

## Nix-first deployment

### Build reproducibility

```toml
[profile.release]
opt-level = 3
lto = true
codegen-units = 1
```

### Runtime configuration

Prefer config files and environment variables over compile-time configuration:

```rust
// GOOD: runtime config, Nix generates the config file
let config = Config::parse();  // clap: CLI args + env vars

// AVOID: compile-time config (breaks Nix caching)
const DB_URL: &str = env!("DATABASE_URL");
```

The Nix module (`nix/modules/eulesia-server.nix`) injects environment
variables into the systemd unit. The binary reads them via `clap`.
