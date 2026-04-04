# Refactoring Patterns

Concrete patterns for decomposing and tightening Rust code. Each pattern
includes the symptom, the technique, and a before/after sketch.

## Pattern 1: Replace boolean flags with enums

### Symptom

A function takes `bool` parameters. Call sites read as `process(true, false)`.

```rust
// BEFORE
fn create_group(name: &str, encrypted: bool, public: bool) -> Result<Group>
create_group("Helsinki Citizens", true, false)?;  // what do true, false mean?

// AFTER
pub enum Encryption { Enabled, Disabled }
pub enum Visibility { Public, Private }

fn create_group(name: &str, enc: Encryption, vis: Visibility) -> Result<Group>
create_group("Helsinki Citizens", Encryption::Enabled, Visibility::Private)?;
```

### When NOT to apply

Single boolean parameters with obvious semantics (`enabled: bool`) are fine.

## Pattern 2: Replace `Option` fields with state enums

### Symptom

A struct has `Option` fields that are always `Some` after a certain point.

```rust
// BEFORE
pub struct DeviceRegistration {
    user_id: Id,
    identity_key: Option<Vec<u8>>,  // Some after key upload
    verified_at: Option<Timestamp>,  // Some after verification
}

// AFTER
pub struct Unregistered { user_id: Id }
pub struct KeyUploaded { user_id: Id, identity_key: Vec<u8> }
pub struct Verified { user_id: Id, identity_key: Vec<u8>, verified_at: Timestamp }

impl Unregistered {
    pub fn upload_key(self, key: Vec<u8>) -> KeyUploaded { ... }
}
impl KeyUploaded {
    pub fn verify(self) -> Verified { ... }
}
```

The type system enforces the state machine.

## Pattern 3: Extract typed error context

### Symptom

Errors use `String` for context, or `anyhow` in library code.

```rust
// BEFORE
fn find_user(id: Id) -> anyhow::Result<User>

// AFTER
#[derive(Debug, thiserror::Error)]
pub enum UserError {
    #[error("user {id} not found")]
    NotFound { id: Id },

    #[error("database error: {context}")]
    Database { context: &'static str, source: sqlx::Error },
}

fn find_user(id: Id) -> Result<User, UserError>
```

Use `&'static str` for context strings that are always literals (no allocation).

## Pattern 4: Flatten nested `match` / `if let` chains

### Symptom

3+ levels of indentation from nested unwrapping.

```rust
// BEFORE
if let Some(user) = users.get(&id) {
    if let Some(device) = user.devices.get(&device_id) {
        if device.is_verified() {
            // actual logic, indented 4 levels
        }
    }
}

// AFTER: early returns
let user = users.get(&id).ok_or(ApiError::NotFound("user not found".into()))?;
let device = user.devices.get(&device_id).ok_or(ApiError::NotFound("device not found".into()))?;
if !device.is_verified() {
    return Err(ApiError::Forbidden);
}
// actual logic, indented 1 level
```

## Pattern 5: Extract configuration from runtime state

### Symptom

A struct mixes immutable configuration with mutable runtime state.

```rust
// BEFORE
struct Server {
    host: String,           // config (immutable)
    port: u16,              // config (immutable)
    connections: Vec<Conn>, // state (mutable)
    message_count: u64,     // state (mutable)
}

// AFTER
pub struct ServerConfig { pub host: String, pub port: u16 }
pub struct ServerState { connections: Vec<Conn>, message_count: u64 }

pub struct Server {
    config: Arc<ServerConfig>,
    state: ServerState,
}
```

## Pattern 6: Replace `String` keys with typed IDs

### Symptom

`HashMap<String, T>` where the keys are identifiers.

```rust
// BEFORE: typos compile, wrong map lookups compile
groups: HashMap<String, Group>,

// AFTER: type-safe
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GroupId(pub Id);

groups: HashMap<GroupId, Group>,
```

## Pattern 7: Extract fat handler into service + prepared plan

### Symptom

An HTTP handler owns transaction management, domain branching, persistence,
and response mapping. It needs `#[allow(clippy::too_many_lines)]`. Two code
paths (e.g., DM vs group) duplicate structure.

### Technique

1. Define a command struct for the handler's input
2. Define a prepared plan struct for the domain output
3. Move domain logic into a service function that returns the plan
4. Keep the handler thin: parse → command → service → response

```rust
// BEFORE: 200+ line handler
pub async fn send(auth: AuthUser, State(state): State<AppState>, ...) -> Result<Json<...>> {
    // validation, txn, branch DM/group, persist, fanout, commit, response
}

// AFTER: thin handler + service
struct SendCommand { caller: Uuid, device_id: Uuid, conversation_id: Uuid, req: SendMessageRequest }

struct PreparedSend {
    stored_ciphertext: Vec<u8>,
    queue_entries: Vec<message_device_queue::ActiveModel>,
    message: messages::Model,
}

impl MessageService {
    async fn send(db: &DatabaseConnection, cmd: SendCommand) -> Result<PreparedSend, SendError> {
        let txn = db.begin().await?;
        let (conv_type, epoch) = lock_conversation(&txn, cmd.conversation_id).await?;
        verify_membership(&txn, cmd.conversation_id, cmd.caller).await?;

        let prepared = match conv_type {
            ConversationType::Direct => prepare_direct(&txn, &cmd).await?,
            ConversationType::Group => prepare_group(&txn, &cmd).await?,
        };

        persist_message(&txn, &prepared).await?;
        txn.commit().await?;
        Ok(prepared)
    }
}

pub async fn send(auth: AuthUser, ...) -> Result<Json<MessageResponse>> {
    let cmd = SendCommand::from_auth(auth, conversation_id, req)?;
    let result = MessageService::send(&state.db, cmd).await?;
    Ok(Json(MessageResponse::from(result)))
}
```

### When duplication signals this pattern

If two branches share:

- the same persistence path (insert row + insert queue entries)
- the same response mapping
- the same transaction/commit flow

Then the branching should produce a **plan**, and the persistence should
consume it uniformly.

## General refactoring heuristics

- **Extract when a function exceeds 40 lines** (hard limit: 60)
- **Extract when nesting exceeds 3 levels** (use early returns)
- **Newtype when 2+ parameters share the same primitive type**
- **Enum when `Option` fields depend on each other**
- **Builder when 4+ fields have defaults**
- **Name extracted functions for what they return**, not what they do:
  `validated_config()` not `do_validation()`
- **Preserve identical behavior**: refactoring is structural, not behavioral
