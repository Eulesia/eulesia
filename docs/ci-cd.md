# CI/CD Pipeline

## Overview

Eulesia uses GitHub Actions for continuous integration and deployment, running on self-hosted Mercury runners.

## Workflows

### CI (`ci.yml`)

Runs on every push to `main` and on pull requests targeting `main`.

**Pipeline stages:**

1. `format-check` -- verifies formatting with `nix fmt -- --fail-on-change .`
2. `flake-check` -- runs `nix flake check` which executes all flake checks (depends on format-check)
3. `ci-success` -- gate job that verifies both previous jobs passed

**Flake checks** (defined in `nix/ci/checks.nix`):

- `format` -- treefmt formatting
- `nix-lint` -- statix and deadnix on Nix code
- `frontend-lint` -- ESLint and TypeScript checking for the frontend
- `api-lint` -- ESLint and TypeScript checking for the API
- `frontend-test` -- frontend test suite
- `api-test` -- API test suite
- `frontend-build` -- production frontend build
- `api-build` -- production API build
- `vm-build` -- MicroVM runner build (x86_64-linux only)
- `test-host-build` -- full test NixOS host build (x86_64-linux only)

**Concurrency:** grouped by workflow + ref, with in-progress cancellation for superseded runs.

### Deploy Production (`deploy-prod.yml`)

Runs on every push to `main`.

**Steps:**

1. Checkout and configure Attic cache
2. Validate deploy configuration (SSH key, known hosts, target host)
3. Setup SSH credentials
4. Build the production NixOS system (`nix build .#nixosConfigurations.eulesia-prod.config.system.build.toplevel`)
5. Deploy with `nix run .#rebuild-prod`
6. Health checks over SSH against `127.0.0.1:3002`
7. Data integrity checks over SSH:
   - `seaql_migrations` row count matches the local migration file count
   - `eulesia_v2` has non-empty `users` and `threads`
   - when the legacy `eulesia` database still exists, all legacy usernames and club slugs must also exist in `eulesia_v2`

**Concurrency:** `deploy-prod` group, never cancels in-progress deploys.

## Runners

All CI jobs run on self-hosted Mercury runners with these labels:

- `self-hosted`
- `nix`
- `mercury`
- `eulesia`

Runners are provisioned through Mercury infrastructure (`~/Repos/infra`), not configured in this repo.

## Binary Cache

An Attic binary cache is available at `cache.digimuoto.com` (accessed via `http://localhost:8088` on Mercury runners). After successful flake checks, built derivations are pushed to the cache to speed up subsequent builds.

## Required Secrets and Variables

### CI workflow

| Name               | Type   | Purpose                                         |
| ------------------ | ------ | ----------------------------------------------- |
| `ATTIC_AUTH_TOKEN` | secret | Attic cache authentication                      |
| `ATTIC_CACHE_NAME` | secret | Attic cache name                                |
| `ATTIC_PUBLIC_KEY` | secret | Attic cache public key for trusted substituters |

### Production deploy workflow

| Name                       | Type     | Purpose                               |
| -------------------------- | -------- | ------------------------------------- |
| `ATTIC_AUTH_TOKEN`         | secret   | Attic cache authentication            |
| `ATTIC_CACHE_NAME`         | secret   | Attic cache name                      |
| `ATTIC_PUBLIC_KEY`         | secret   | Attic cache public key                |
| `EULESIA_PROD_TARGET_HOST` | variable | SSH target hostname for production    |
| `EULESIA_PROD_SSH_KEY`     | secret   | SSH private key for production deploy |
| `EULESIA_PROD_KNOWN_HOSTS` | secret   | SSH known hosts for production host   |

## Timeouts

- Format check: 10 minutes
- Flake check: 30 minutes
- Production deploy: 45 minutes
