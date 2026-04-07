# Eulesia Deployment Guide

## Overview

Eulesia now treats Nix as the canonical path for:

- local development
- build outputs
- deployment configuration
- CI entrypoints

The flake exposes:

- `nix develop` and `just` for developer workflow
- `nix run .#ci-check` for runner-agnostic CI checks
- `nixosModules.eulesia` for reusable service configuration
- `nixosConfigurations.eulesia-vm` plus `just vm-run` and `just vm-deploy` for local MicroVM validation
- `nixosConfigurations.eulesia-test-bootstrap`, `just bootstrap-test`, and `just get-test-age-key` for first install of the public test host
- `nixosConfigurations.eulesia-test`, `nix run .#rebuild-test`, and `nix run .#deploy-test` for the public test host after bootstrap
- `nixosConfigurations.eulesia-prod-bootstrap`, `just bootstrap-prod`, and `just get-prod-age-key` for first install of the production host
- `nixosConfigurations.eulesia-prod`, `nix run .#rebuild-prod`, and `nix run .#deploy` for the production host after bootstrap

The old Docker Compose setup is deprecated and should only be treated as a temporary fallback while the production host is migrated.

## Install Nix

Eulesia expects a working Nix installation with `nix-command` and `flakes` enabled. Use the official Nix installer and docs:

- official install page: <https://nixos.org/download/>
- quick start and manual: <https://nix.dev/manual/nix/2.34/quick-start>

Current recommended install commands from the official download page:

### Linux

Recommended multi-user install:

```bash
sh <(curl --proto '=https' --tlsv1.2 -L https://nixos.org/nix/install) --daemon
```

### macOS

Recommended multi-user install:

```bash
sh <(curl --proto '=https' --tlsv1.2 -L https://nixos.org/nix/install)
```

After installation:

1. Open a new terminal.
2. Ensure flakes are enabled for your user if they are not already:

```bash
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

3. Verify that Nix works:

```bash
nix --version
```

## New Developer Bootstrap

For a new developer workstation:

1. Clone the repository and enter it:

```bash
git clone https://github.com/Eulesia/eulesia.git
cd eulesia
```

2. Enter the dev shell:

```bash
nix develop
```

3. Inside the dev shell, inspect the primary commands:

```bash
just
```

4. Start the local stack:

```bash
just dev
```

This starts:

- PostgreSQL
- Meilisearch
- API on `http://localhost:3001`
- frontend on `http://localhost:5173`

The default dev shell already provides the tools needed for the Nix workflow, including:

- `just`
- `sops`
- `age`
- `nixos-anywhere`
- PostgreSQL and Meilisearch client binaries

If a developer only needs local app development, this is enough. If they need test secrets or deploy access, continue with [Developer Workstation Key Onboarding](./secrets.md#developer-workstation-key-onboarding).

## Local Validation

```bash
nix develop
just dev
```

This starts:

- PostgreSQL
- Meilisearch
- API on `http://localhost:3001`
- frontend on `http://localhost:5173`

Useful validation commands:

```bash
just lint
just test
just build
just audit-prod-secrets
just test-host-bootstrap-build
just prod-host-bootstrap-build
just vm-build
just test-host-build
just prod-host-build
nix run .#ci-check
```

For a production-like local deployment target, use:

```bash
just vm-run
just vm-deploy
```

This exposes:

- app and API on `http://localhost:18080`
- SSH on `root@localhost:2223`
- Meilisearch on `http://localhost:17701/health`

PostgreSQL is guest-only by default.

Those localhost ports must be free before `just vm-run` starts the VM.

## NixOS Module

The reusable deployment surface lives in `nixosModules.eulesia`.

It configures:

- the packaged API service
- the packaged frontend served by nginx
- local PostgreSQL and Meilisearch when enabled
- uploads storage
- TLS termination either directly through nginx or behind an external edge proxy such as Traefik
- environment and secret injection for the API

The module interface is centered on `services.eulesia.*`, including:

- `package` and `frontendPackage`
- `appDomain`, `apiDomain`, and `adminDomain`
- `database.{createLocally,name,user,url}`
- `meilisearch.{createLocally,listenAddress,listenPort,url,masterKeyFile}`
- `auth.{sessionSecretFile,bootstrapAdminAccountsFile}`
- `auth.idura.{enable,domain,clientId,callbackUrl,signingKeyFile,encryptionKeyFile}`
- `email.smtp.{host,port,secure,userFile,passFile}`
- `push.{vapidPublicKeyFile,vapidPrivateKeyFile,vapidSubject,firebaseServiceAccountKeyFile}`
- `ai.{mistralApiKeyFile,mistralModel}`
- `extraEnvironment`
- `extraSecretEnvironmentFiles`

## Admin Subdomain

The admin panel is served from a dedicated subdomain:

- Production: `admin.eulesia.org`
- Test: `admin.test.eulesia.org`

This is configured via the `services.eulesia.adminDomain` NixOS option. When set, the module creates an nginx virtual host that:

- redirects `= /` to `302 /admin` (so visiting the bare admin domain goes to the admin login)
- serves the frontend static build for all other paths

Traefik routes external HTTPS traffic to the nginx vhost with TLS termination. The admin domain needs a DNS record pointing to the same host as the main app domain.

Cookie domain is set to the parent domain (`.eulesia.org` for production, `.test.eulesia.org` for test) via `services.eulesia.auth.cookieDomain`. This allows the `admin_session` cookie to be shared across the admin subdomain and the main app domain.

Admin authentication is entirely separate from user authentication. See [Admin Surface](./admin-surface.md) for details.

## Production Configuration

`nixosConfigurations.eulesia-prod` is the production-oriented host definition for `eulesia.org`.

Current assumptions in the repo:

- deploy SSH target alias: `eulesia-server-prod`
- SSH user: `root`
- production domains: `eulesia.org`, `api.eulesia.org`, and `admin.eulesia.org`
- test domains: `test.eulesia.org`, `api.test.eulesia.org`, and `admin.test.eulesia.org`
- both test and production use Traefik as the public edge, with the Rust server bound to `127.0.0.1:3002` as the internal origin
- both test and production use a same-origin browser API base on the app domain, with `api.*` kept as an alias and compatibility host
- the test host bootstrap uses `disko` with `/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_114774765` as the system disk and `/dev/disk/by-id/scsi-0HC_Volume_105267941` as the PostgreSQL volume
- the production host bootstrap uses `disko` with `/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_114785278` as the system disk and `/dev/disk/by-id/scsi-0HC_Volume_105268989` as the PostgreSQL volume
- managed runtime secrets live under `secrets/prod/` and `secrets/test/`
- one encrypted file per secret is used, with names such as `session-secret.enc`, `admin-accounts.json.enc`, and `firebase-service-account.json.enc`
- `sops-nix` materializes runtime secret files under `/run/secrets/eulesia/`
- the packaged frontend uses a same-origin `/api` base, so the same static build works for VM, test, and production hosts

Before the first production switch, verify all of the following:

- `api.eulesia.org` DNS exists and points at the production host, so ACME can issue both certificates
- the operator can SSH to `eulesia-server-prod` as `root` with an authorized public key
- the production host Age recipient has been added to `.sops.yaml` and `secrets/prod/*` have been re-encrypted
- `just audit-prod-secrets` reports no obvious placeholders
- `services.eulesia.auth.idura.*` has real production values before enabling FTN on production

Current production caveats in the repo:

- production Idura/FTN is configured for `eulesia.idura.broker` and client `urn:my:application:identifier:524753`, but the Idura application must still have the matching static client JWKS registered and the callback URL `https://eulesia.org/api/v1/auth/ftn/callback` allowed
- Firebase/FCM is intentionally disabled until `secrets/prod/firebase-service-account.json.enc` contains a real service account JSON

For bootstrap-managed admin accounts, changes to `secrets/<env>/admin-accounts.json.enc` only take effect after a deploy or host rebuild runs the API `preStart` bootstrap step. The operational runbook for add, rotate, recover, and deprovision flows is documented in [Admin Surface](./admin-surface.md).

## Test Deployment Access Model

The test deployment has three separate access layers:

1. Secret decryption on the developer workstation
2. SSH access to the test host
3. GitHub Actions configuration for merge-to-`main` deploys

For direct workstation deploys to the test host, a developer needs all of the following:

- their workstation Age recipient added to `.sops.yaml`
- `secrets/test/*` re-encrypted after the recipient is added
- their SSH public key authorized on the test host
- a reachable SSH target, either via the local alias `eulesia-server-test` or `EULESIA_TEST_TARGET_HOST`

For CI deploys from `Eulesia/eulesia`, the required GitHub Actions settings are:

- variable `EULESIA_TEST_TARGET_HOST`
- secret `EULESIA_TEST_SSH_KEY`
- secret `EULESIA_TEST_KNOWN_HOSTS`

The self-hosted runners themselves are not configured in this repo. They are provided by Mercury through `~/Repos/infra` and require the Mercury secret:

- `github/eulesia-runner-token`

The deploy workflow expects runner labels:

- `self-hosted`
- `nix`
- `mercury`
- `eulesia`

## Required Secrets

The canonical inventory, purpose, and generation guidance lives in [Secrets](./secrets.md).

The admin authorization and bootstrap model is documented in [Admin Surface](./admin-surface.md).

The production secret tree currently materializes these files under `/run/secrets/eulesia/`:

- `/run/secrets/eulesia/session-secret`
- `/run/secrets/eulesia/meili-master-key`
- `/run/secrets/eulesia/mistral-api-key`
- `/run/secrets/eulesia/smtp-user`
- `/run/secrets/eulesia/smtp-pass`
- `/run/secrets/eulesia/vapid-public-key`
- `/run/secrets/eulesia/vapid-private-key`
- `/run/secrets/eulesia/idura-signing-key.jwk.json`
- `/run/secrets/eulesia/idura-encryption-key.jwk.json`

The test host also expects:

- `/run/secrets/traefik-basic-auth-password`

For FTN/Idura tenants, the operator flow is:

1. Run `just generate-idura-jwks local/idura-jwks`.
2. Encrypt `idura-signing-key.jwk.json` and `idura-encryption-key.jwk.json` into `secrets/<env>/`.
3. Upload `idura-client-jwks.public.json` to the matching Idura application as the static client JWKS.
4. Configure the Idura app to use signed requests, `private_key_jwt`, and encrypted token responses.
5. Deploy the matching NixOS host config.

When syncing to an existing Idura app, reuse the matching private JWKs instead of generating a fresh pair. For the current test tenant, the local operator source is the untracked `local/jwks.private.json`.

Before first production cutover, audit the committed prod secrets for placeholders:

```bash
just audit-prod-secrets
```

## Deploy

Build and deploy through the flake:

```bash
nix build .#nixosConfigurations.eulesia-test-bootstrap.config.system.build.toplevel
nix build .#nixosConfigurations.eulesia-test.config.system.build.toplevel
nix run .#bootstrap-test
nix run .#get-test-age-key
nix run .#rebuild-test
nix run .#deploy-test

nix build .#nixosConfigurations.eulesia-prod-bootstrap.config.system.build.toplevel
nix build .#nixosConfigurations.eulesia-prod.config.system.build.toplevel
nix run .#bootstrap-prod
nix run .#get-prod-age-key
nix run .#rebuild-prod
nix run .#deploy
```

### Test Host First Install

Use `nix run .#bootstrap-test` once for the first install and `nix run .#rebuild-test` for normal test-host updates. Both commands default to the local SSH target alias `eulesia-server-test`; override it with `EULESIA_TEST_TARGET_HOST` when needed.

For a fresh Hetzner test host:

1. Bootstrap the minimal host:

```bash
just test-host-bootstrap-build
just bootstrap-test
```

2. Retrieve the generated test-host Age recipient:

```bash
just get-test-age-key
```

3. Add that public key to `.sops.yaml` for the test secret rule and re-encrypt the test secrets:

```bash
find secrets/test -name '*.enc' -print0 | xargs -0 -n1 sops updatekeys
```

4. Build and switch the real test host configuration:

```bash
just test-host-build
just rebuild-test
```

After the full test configuration is active, run update commands from a machine that is allowed to SSH to the host, typically Mercury or another VPN-attached machine.

Before a developer can work with `secrets/test/*` or run `just rebuild-test` from their own workstation, their workstation Age recipient must be added to `.sops.yaml` and the test secrets must be re-encrypted. See [Developer Workstation Key Onboarding](./secrets.md#developer-workstation-key-onboarding).

### Test Host Normal Updates

For later changes to an already bootstrapped test host:

```bash
just test-host-build
just rebuild-test
```

### Test Deployment from CI

Merge-to-`main` test deployment runs through `.github/workflows/deploy-test.yml`.

That workflow only works when all of the following are already in place:

- Mercury has active self-hosted runners for `Eulesia/eulesia`
- `Eulesia/eulesia` GitHub Actions has:
  - variable `EULESIA_TEST_TARGET_HOST`
  - secret `EULESIA_TEST_SSH_KEY`
  - secret `EULESIA_TEST_KNOWN_HOSTS`

The workflow builds the test system, deploys it with `nix run .#rebuild-test`, and then verifies health over SSH against `127.0.0.1:3002` on the target host.

### Production First Install

Use `nix run .#bootstrap-prod` once for the first install and `nix run .#rebuild-prod` for normal production-host updates. Both commands default to the local SSH target alias `eulesia-server-prod`; override it with `EULESIA_PROD_TARGET_HOST` when needed.

For a fresh Hetzner production host:

1. Audit the committed production secrets:

```bash
just audit-prod-secrets
```

2. Bootstrap the minimal host:

```bash
just prod-host-bootstrap-build
just bootstrap-prod
```

This step is destructive. It repartitions both the system disk and the PostgreSQL volume.

3. Retrieve the generated production-host Age recipient:

```bash
just get-prod-age-key
```

4. Add that public key to `.sops.yaml` for the production secret rule and re-encrypt the production secrets:

```bash
find secrets/prod -name '*.enc' -print0 | xargs -0 -n1 sops updatekeys
```

5. Ensure the production prerequisites are ready:

- `eulesia.org` and `api.eulesia.org` both point at the production host
- `just audit-prod-secrets` passes
- the Idura application at `eulesia.idura.broker` has the matching static client JWKS registered and allows `https://eulesia.org/api/v1/auth/ftn/callback`
- `secrets/prod/firebase-service-account.json.enc` contains a real Firebase service account before enabling FCM/native push

6. Build and switch the real production configuration:

```bash
just prod-host-build
just rebuild-prod
```

### Production Normal Updates

For later changes to an already bootstrapped production host:

```bash
just prod-host-build
just rebuild-prod
```

`nix run .#deploy-test` and `nix run .#deploy` remain available through `deploy-rs` for manual use. All remote deployment paths assume the target host already has its own `/var/lib/sops-nix/key.txt` in place.

The API service runs database migration as a pre-start step, so configuration switches restart the app against the current schema automatically.

That schema step is not enough to declare a deployment correct on its own. When a legacy `eulesia` database still exists alongside `eulesia_v2`, post-deploy verification must also compare live data presence between the two databases. At minimum:

- `seaql_migrations` row count on `eulesia_v2` must match the local migration file count
- `users` and `threads` on `eulesia_v2` must be non-empty
- legacy usernames and club slugs from `eulesia` must also exist in `eulesia_v2`

## VM Target

Use the VM configuration to validate the service stack without touching production:

```bash
just vm-build
just vm-run
just vm-deploy
```

The VM is a persistent local MicroVM with:

- shared host `/nix/store` over `virtiofs`
- a writable Nix store overlay for hot deployment
- a persistent `/var` volume for PostgreSQL, Meilisearch, uploads, and guest state
- localhost port forwards for the web surface, SSH, and Meilisearch

The VM config uses:

- plain HTTP
- local PostgreSQL
- local Meilisearch
- packaged frontend + API from this flake

`just vm-run` and `just vm-deploy` use the dedicated local VM key at `$HOME/.local/share/eulesia/vm-sops-age.key`, not the workstation `sops` keyring. They also refuse to run while plaintext runtime secret files like `secrets.env`, `idura-signing-key.jwk.json`, or `idura-encryption-key.jwk.json` are present in the repo root.

## Hetzner Bootstrap Reference

The detailed operator walkthrough lives in [Deploy](#deploy), especially [Test Host First Install](#test-host-first-install) and [Production First Install](#production-first-install). This section captures the host-specific facts that the bootstrap configurations currently assume.

All bootstrap installs are destructive. `nixos-anywhere` plus `disko` repartitions the target disks and replaces the existing operating system.

The shared disk layout shape is:

- system disk: GPT, `1M` BIOS boot partition, `500M` EFI system partition mounted at `/boot`, ext4 root filesystem on `/`
- PostgreSQL volume: GPT, single ext4 filesystem mounted at `/var/lib/postgresql`

The currently wired host disk IDs are:

- test system disk: `/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_114774765`
- test PostgreSQL volume: `/dev/disk/by-id/scsi-0HC_Volume_105267941`
- production system disk: `/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_114785278`
- production PostgreSQL volume: `/dev/disk/by-id/scsi-0HC_Volume_105268989`

## Legacy Docker Assets

The following remain in the repo during the migration period:

- `docker/docker-compose.yml`
- `docker/docker-compose.prod.yml`
- `docker/Dockerfile.*`
- `scripts/deploy.sh`
- `scripts/setup-server.sh`

They are no longer the primary deployment path and should not be extended further unless the Nix migration is blocked.
