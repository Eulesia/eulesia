# Code Review Rubric

Structured approach to reviewing Rust modules in the Eulesia v2 server.
Score 1–10 on each axis, weight by relevance to the module's role.

## Axes

### Type safety (weight: high)

- Newtypes at public API boundaries for same-typed parameters
- Illegal states unrepresentable (enums over structs-with-options)
- No `unwrap()` / `expect()` outside tests and infallible paths
- `unsafe` is forbidden (workspace lint: `unsafe_code = "forbid"`)
- E2EE data is opaque `Vec<u8>` — no server-side interpretation

### Error handling (weight: high)

- `ApiError` for HTTP-facing errors with proper status codes
- Domain error enums in library crates (`thiserror`)
- `anyhow` only in the server binary
- Error variants name domain failure modes, not implementation details
- Sufficient context to diagnose without a debugger
- `?` propagation doesn't erase important context (use `.map_err()`)
- Never `#[from]` on `DbErr`, `sqlx::Error`, or other broad infrastructure errors — always add context at the call site

### Ownership & borrowing (weight: high)

- Core domain types own their data (no unnecessary lifetimes)
- Borrow at API edges and view functions
- No `clone()` to satisfy the borrow checker without understanding why
- `Arc` used only for shared ownership across threads

### Architecture (weight: high)

- Clear crate boundaries: `common` → `db`/`auth` → `api` → `server`
- `common` has zero IO dependencies
- Configuration separated from runtime state
- Builder pattern for complex construction (4+ fields with defaults)
- Trait objects only at true plugin/extension boundaries

### Concurrency (weight: medium-high)

- `Send + Sync` bounds explicit on trait objects crossing thread boundaries
- No `std::sync::Mutex` held across `.await` points
- Channel-based communication preferred over shared mutable state
- Cancellation safety documented for async operations

### Performance (weight: varies)

- Hot path vs cold path separated
- No accidental `O(n²)` from nested iterations
- Benchmarks exist for performance-critical paths
- Allocation discipline on message relay paths

### API design (weight: medium)

- Functions take the most general input type they can use
  (`&str` not `&String`, `&[T]` not `&Vec<T>`)
- Public types implement standard traits (`Debug`, `Clone`, `PartialEq`)
- Constructors validate invariants
- Request/response types use `serde` derives

### Style (weight: low)

- `clippy::all` deny, `clippy::pedantic` warn, `clippy::nursery` warn — clean
- No dead code
- Module files ≤ 500 lines
- Doc comments on all public items

## Scoring guide

- **9–10**: Production-grade. Types enforce invariants, errors are domain
  vocabulary, ownership model is clean.
- **7–8**: Solid with improvement areas. Working code with identifiable
  type safety or error handling gaps.
- **5–6**: Functional but carries debt. Stringly-typed APIs, `unwrap()`
  in non-obvious paths, or `clone()` to paper over ownership issues.
- **3–4**: Significant issues. Swallowed errors, `Arc<Mutex<T>>`
  everywhere, or wrong async patterns.
- **1–2**: Needs rewrite. Panics in library code, data races, or unsound patterns.

## Review structure

1. **Overall score** with one-line justification
2. **Strengths**: 2–4 specific things done well, with code references
3. **Issues**: Ranked by severity, with concrete fixes
4. **Style notes**: Minor observations that don't affect the score

## Anti-patterns to flag

### The `clone()` escape hatch

```rust
// Symptom: clone() to satisfy borrow checker
let name = self.config.name.clone();
process(&name, &self.config);  // could just borrow differently
```

### Stringly-typed APIs

```rust
// BAD
fn set_role(&mut self, role: &str) -> Result<(), Error>

// GOOD
fn set_role(&mut self, role: MemberRole) -> Result<(), Error>
```

### The `Arc<Mutex<HashMap<...>>>` god state

```rust
// Fix: typed state structs, channel-based communication, or actor pattern
```

### Error context erasure

```rust
// BAD: which query failed?
let user = sqlx::query("...").fetch_one(&pool).await?;

// GOOD: context preserved
let user = sqlx::query("...")
    .fetch_one(&pool)
    .await
    .map_err(|e| UserError::Database { context: "find_by_id", source: e })?;
```

### `#[from]` on broad errors

```rust
// BAD: Database(#[from] sea_orm::DbErr) erases call-site context.
// Every DB error looks identical in logs.

// GOOD: explicit map_err with context at every call site.
```

### Fat handler (domain logic in HTTP layer)

Handler should parse, authenticate, delegate, respond. If it owns
transactions, domain branching, and persistence, extract a service.
See `architecture.md` → "Handler / service separation".

### Stringly-typed domain branching

```rust
// BAD: string comparison for core domain state
if conv.r#type == "direct" { ... }

// GOOD: enum at the domain layer
match conv.conversation_type {
    ConversationType::Direct => ...,
    ConversationType::Group => ...,
}
```

### Silent ciphertext fallback

In E2EE systems, never silently serve ciphertext encrypted for a
different device. If the requesting device has no entry, return an
explicit error or empty field — not someone else's ciphertext.

### `async` for CPU-bound work

```rust
// BAD
async fn hash_password(password: &str) -> Result<String>

// GOOD: sync, use spawn_blocking if called from async
fn hash_password(password: &str) -> Result<String>
```
