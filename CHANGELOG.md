# Changelog — Ascend (BDBLabs/ascend)

Monorepo (`ascend` workspaces): `apps/product`, `apps/control`,
`packages/*`. Format follows Keep a Changelog. Tags: `v0.1.0`.

## [Unreleased]

### Added (P1.3 — environment separation)
- `packages/database/env-guard.mjs`: owner-credential tools
  (migrate, verify, both seeds) require a declared `ENVIRONMENT` and fail
  before connecting otherwise. Seeds and verify never run on production
  (no override); migrate on production requires per-invocation
  `ALLOW_PRODUCTION_DB_MUTATION=1`. 15 tests.
- `scripts/write-neon-env.mjs` stamps `ENVIRONMENT` into every generated
  env file; operator-supplied overrides are stripped.

### Added (P1.1 — function privilege lockdown)
- Migration `032_function_privilege_lockdown.sql`: revokes default PUBLIC
  execute on all application functions, closes the default for future
  functions (`ALTER DEFAULT PRIVILEGES`), restates the full explicit grant
  matrix (tenant primitives to all app roles; service functions to
  `platform_runtime`/`control_app` only; trigger helpers ungranted).
  Corrects `set_application_context` (was granted TO PUBLIC) and grants the
  previously-default 023 dispatch overload + 017 idempotency helpers.
- Check suite `function-acls.sql` (runs under `db:verify`): fails on any
  PUBLIC-executable function, missing grants, tenant-role excess, or broken
  secure defaults. Branches must be at 032+ to pass.

## [0.1.0] - 2026-09-25

First production-distribution snapshot. Staging-complete; **not GA** —
see "GA gates" below and `docs/assurance/REMEDIATION_PLAN.md`.

### Added
- Ascend domain foundation through phase 8 plus the commercial loop:
  domain types + data-access + tests (phase 1), work packages (2), project
  costs (3), parts/procurement (4), progress read model with earned value
  (5), progress billing with frozen snapshots (6), workspace read UI (7),
  brand cleanup behind `ASCEND_MODE` (8), write actions API + forms,
  estimates/change-value/invoices/billed, obligations tracing, cron secret.
- Production fail-closed demo guard: a production process refuses the
  `FIELD_DEMO_MODE` owner principal unless the explicit acknowledgement
  `FIELD_DEMO_ALLOW_IN_PRODUCTION=1` is also set (code-level P0.1,
  `apps/product/src/lib/field-api-auth.ts`, 6 tests in
  `src/lib/field-api-auth.test.ts`). Documented in `.env.example`.
- `DEPLOYMENT.md`: Fly ×2 + Vercel targets, environment contract, database
  migrate/verify/seed, health checks, cron, production checklist.
- `SECURITY.md`: tenant isolation, demo-mode, secrets, and auth notes.
- `.github/workflows/release.yml`: tag-gated (`v*`) full verification
  (`secrets:check`, lint, test, `build:all`, production audit), Docker
  builds for both apps, GitHub Release with generated notes.

### Deployment targets (already present, now documented)
- `fly.product.toml` (`ascend-product`, iad, `/api/health`) +
  `apps/product/Dockerfile` (standalone Next, non-root).
- `fly.control.toml` (`ascend-control`, iad, `/api/health`) +
  `apps/control/Dockerfile`.
- `apps/product/vercel.json` (transactional-outbox cron).

### GA gates (not yet closed)
- `docs/assurance/REMEDIATION_PLAN.md` P0–P3 items, including P0.2
  (keep outbound email disabled until delivery/outbox remediation).
- `ISSUES.md` open items (11 at last snapshot).
- Legal review gate in README (NY GBL Art. 36-A escrow, §396-t
  cooling-off, Suffolk HIC license, ST-124).

## Prior history (pre-tag, from git log)

- 2026-09-08 — domain foundation migration 024; CSP strict-nonce fix;
  token-bucket rate limit; onboarding honeypot; request body byte-size
  enforcement; outbox double-send fix; `.env.example` reconciliation.
- 2026-08-23/25/26 — AI actor authority + tool registry + governance ADR;
  AI assistant loop; dispatch portal; storefront/invoice/change-order/mobile.
- 2026-08-14 — cross-layer assurance snapshot
  (`docs/assurance/CURRENT_STATE.md`): Vercel production deployments
  verified READY at the reviewed commit; demo-principal exposure,
  secret-in-`if` CI, and env-separation defects recorded with exit evidence.
