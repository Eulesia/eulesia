# Rollback Procedure

## Automatic Rollback (deploy-rs)

Production deploys use [deploy-rs](https://github.com/serokell/deploy-rs) which provides automatic rollback. If the new system activation fails (services don't start, SSH becomes unreachable), deploy-rs automatically reverts to the previous generation.

This happens without manual intervention.

## Manual Rollback

If a deploy succeeds (activation passes) but the application is broken:

```bash
# SSH to the server
ssh root@eulesia-server-prod

# List available generations
nixos-rebuild list-generations

# Roll back to previous generation
nixos-rebuild switch --rollback

# Or switch to a specific generation
nix-env --switch-generation <number> -p /nix/var/nix/profiles/system
/nix/var/nix/profiles/system/bin/switch-to-configuration switch
```

## Generation Limits

Servers keep 3 GRUB generations and run weekly garbage collection:

- `boot.loader.grub.configurationLimit = 3` — only 3 boot entries
- `nix.gc.automatic = true` with `--delete-older-than 14d` — weekly cleanup

This means you have up to 3 rollback points available.

## When to Rollback

- API health check fails (`/api/v1/health`)
- Admin panel unreachable
- User-facing errors after deploy
- Database migration caused data issues (rollback code, then fix migration)

## Post-Rollback

1. Verify the service is healthy: `systemctl status eulesia-server`
2. Check the health endpoint: `curl -fsS http://127.0.0.1:3002/api/v1/health`
3. If both `eulesia` and `eulesia_v2` exist, compare critical data presence before declaring recovery complete
4. Investigate the failed deploy on a branch — don't push to main until fixed
5. The failed deploy's CI run will have build logs in GitHub Actions

## Database Considerations

NixOS rollback reverts the system (code, config, services) but **not the database**. If a SeaORM migration ran during the failed deploy:

- Migrations are idempotent — re-running them after rollback is safe
- If a migration caused data loss, you need a database backup restore (separate procedure)
- SeaORM migrations run on server startup and are tracked in the `seaql_migrations` table
