# description: Post-deploy verification and data integrity checks

## Usage

```
/deploy-verify <environment>
```

Where `<environment>` is `test` or `prod`.

## Context Detection

- Triggered after deploying to test or prod
- Triggered when migration changes are shipped
- Triggered when the user reports something "doesn't work" or "data is missing"
- MUST be run before declaring any deployment successful

## Why This Exists

On 2026-04-07 we discovered that the v1→v2 migration left data behind
because the v2 server was deployed to a separate database. The migration
code ran perfectly — against an empty database. Tests passed. CI was green.
But 2 clubs, their members, rooms, moderation history, and edit history
were never copied. This was not discovered for weeks.

**"It compiles and tests pass" is not evidence of correctness when the
system involves persistent state on remote servers.**

## Workflow

### 1. SSH and verify data presence

```bash
# Connect to the target server
ssh root@eulesia-server-<env>

# Check which database the server uses
systemctl cat eulesia-server | grep DATABASE_URL

# Check table row counts
sudo -u postgres psql -d eulesia_v2 -c "
SELECT relname as table_name, n_live_tup as rows
FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY n_live_tup DESC;
"
```

### 2. Verify critical data

```bash
# Users exist
sudo -u postgres psql -d eulesia_v2 -c "SELECT COUNT(*) FROM users;"

# Clubs and members exist
sudo -u postgres psql -d eulesia_v2 -c "
SELECT c.name, COUNT(cm.user_id) as members
FROM clubs c LEFT JOIN club_members cm ON cm.club_id = c.id
GROUP BY c.name;
"

# Threads exist with authors
sudo -u postgres psql -d eulesia_v2 -c "
SELECT COUNT(*) as total,
       COUNT(CASE WHEN author_id IS NOT NULL THEN 1 END) as with_author
FROM threads WHERE deleted_at IS NULL;
"

# Municipalities have coordinates (required for map)
sudo -u postgres psql -d eulesia_v2 -c "
SELECT COUNT(*) as total,
       COUNT(CASE WHEN latitude IS NOT NULL THEN 1 END) as with_coords
FROM municipalities;
"

# Sessions are valid
sudo -u postgres psql -d eulesia_v2 -c "
SELECT COUNT(*) as total,
       COUNT(CASE WHEN expires_at > NOW() THEN 1 END) as valid
FROM sessions;
"
```

### 3. Verify API is responding

```bash
# Health check
curl -s https://<env>.eulesia.org/api/v1/health | jq

# Auth config
curl -s https://<env>.eulesia.org/api/v1/auth/config | jq

# Thread list returns data (not empty)
curl -s https://<env>.eulesia.org/api/v1/agora/threads?limit=1 | jq '.data.items | length'
```

### 4. Verify migrations ran

```bash
sudo -u postgres psql -d eulesia_v2 -c "
SELECT version FROM seaql_migrations ORDER BY version;
"
```

Compare count with local: `ls crates/db/src/migration/m[0-9]*.rs | wc -l`

### 5. Check server logs for errors

```bash
journalctl -u eulesia-server --since "10 min ago" --no-pager | grep -i "error\|panic\|failed"
```

## After Schema/Migration Changes

When a PR includes database migrations, these additional checks apply:

1. **Before merging**: Verify migration is idempotent (uses `IF NOT EXISTS`
   or conditional logic)
2. **After deploy**: Run migration count check (step 4 above)
3. **Data verification**: If migration modifies data (UPDATE/DELETE), verify
   row counts before and after match expectations
4. **Rollback readiness**: Document how to reverse the migration

## Red Flags

| Signal                                | What it means                | Action                                     |
| ------------------------------------- | ---------------------------- | ------------------------------------------ |
| `seaql_migrations` doesn't exist      | Server hasn't run migrations | Check DATABASE_URL, restart server         |
| Table has 0 rows but should have data | Data wasn't migrated         | Check if data exists in another database   |
| Migration count mismatch              | New migrations haven't run   | Restart server (migrations run on startup) |
| `IF NOT EXISTS` in migration          | Schema-only, no data         | Verify data was copied separately          |
| Two databases exist                   | Possible data split          | Compare data between both                  |

## Invariants

These must always be true after a successful deploy:

- [ ] `seaql_migrations` row count matches local migration file count
- [ ] `users` table is non-empty
- [ ] `threads` table is non-empty (unless fresh install)
- [ ] Server responds on /api/v1/health
- [ ] Auth config returns expected registration mode
- [ ] No ERROR or PANIC in last 10 minutes of logs

## Output Format

```
## Deploy Verification: <environment>

### Data Integrity

| Check | Result |
|-------|--------|
| Database: <name> | <db name from DATABASE_URL> |
| Migrations | <count> applied, <expected> expected |
| Users | <count> |
| Threads | <count> |
| Clubs | <count> with <member_count> members |
| Municipalities | <count> (<with_coords> with coordinates) |
| Active sessions | <count> |

### API Health

| Endpoint | Status |
|----------|--------|
| /health | <ok/fail> |
| /auth/config | <ok/fail> |
| /agora/threads | <ok/fail, count> |

### Server Logs

<clean | errors found: details>

### Verdict

<PASS | FAIL — issues>
```
