# Ascend — Production Deployment Guide

`v0.1.0` snapshot, verified 2026-09-25 via `npm run verify:ci`
(`secrets:check`, lint, workspace tests, `build:all`, production audit); the
GA remediation adds the database, promotion and preflight gates below.
Staging-complete; **not GA** — `CHANGELOG.md` lists the GA gates.

## 1. Targets

| Surface | Primary target | Config |
|---|---|---|
| Product (Storefront + Field) | Fly `ascend-product` (iad) | `fly.product.toml`, `apps/product/Dockerfile` |
| Control (operator plane) | Fly `ascend-control` (iad) | `fly.control.toml`, `apps/control/Dockerfile` |
| Cron | Vercel `/api/cron/transactional-outbox` daily 08:00 | `apps/product/vercel.json` |

Dockerfiles build from the **repository root** (workspace lockfile +
`packages/*` must be in context):

```bash
fly deploy --config fly.product.toml   # from repo root
fly deploy --config fly.control.toml   # from repo root
```

Images run Next `standalone` output as non-root (`nextjs`), `NODE_ENV=production`,
health-checked at `/api/health` (15s interval, 20s grace). One machine is kept
running (`min_machines_running = 1`) — Fly must not stop idle machines.

## 2. Environment

`.env.example` is the contract. Rules (load-bearing, from prior incidents):

1. Every environment gets its **own Neon branch**. Never share an endpoint
   between local, preview, and production.
2. The runtime credential is NEVER the table owner and never holds BYPASSRLS.
   `DATABASE_URL_OWNER` is for migrations only and never ships to a running app.
3. `FIELD_DEMO_MODE=1` opens the Field workspace to a synthetic OWNER principal.
   A production deployment (`ASCEND_ENVIRONMENT=production` or
   `VERCEL_ENV=production`) **refuses to start** while `FIELD_DEMO_MODE`,
   `DEVELOPMENT_FIELD_ORGANIZATION_ID` or `FIELD_DEMO_ALLOW_IN_PRODUCTION` is set
   (P0.1, `apps/product/src/instrumentation.ts`).
4. `RESEND_API_KEY` intentionally unset until the email hold is lifted —
   estimate email fails closed rather than queuing (P0.2). The outbox itself is
   now recoverable (P3.3); lifting the hold is a sender/domain/recipient-policy
   decision plus one approved real delivery.
5. Secrets from the secret manager, never committed: `CONTROL_API_TOKEN`
   (service, min 16), `CONTROL_OPERATORS_JSON` (control only: operator token
   HASHES), `CRON_SECRET`, `FIELD_AUTH_SECRET` (min 32), `CUSTOMER_LINK_SECRET`
   (min 32), `STORAGE_S3_*`. **`FIELD_PROVISION_SECRET` is gone** — unset it
   everywhere; staff are provisioned by control-plane operators (P2.1).
6. `ASCEND_ENVIRONMENT` must be declared on Fly (`[env]` in `fly.*.toml`) and
   agree with the database stamp; see `docs/DATABASE_SETUP.md#environment-identity`.

## 3. Database

```bash
ASCEND_ENVIRONMENT=development npm run db:migrate    # owner credential, migrations only
ASCEND_ENVIRONMENT=development npm run db:status     # applied-migration inventory
ASCEND_ENVIRONMENT=development npm run db:verify     # every checks/*.sql suite; never production
ASCEND_ENVIRONMENT=development npm run db:seed:dev   # development tenants only, never production
ASCEND_ENVIRONMENT=production  npm run db:preflight -- --app-env=<pulled env file>   # read-only gate
```

Production migrations need `ASCEND_ENVIRONMENT=production` **and** `--production`,
and run **before** the code that needs them is deployed.

Isolation is enforced in the database (forced RLS, restricted runtime roles
`contractor_app` / `platform_runtime` / `control_app`), not in the app layer.
`docs/assurance/TENANT_ISOLATION.md` and `DATABASE_SETUP.md` are authoritative.

## 4. Verification before every promotion

```bash
npm ci
npm run secrets:check
npm run lint
npm test
npm run build:all
npm run audit:production
# or: npm run verify:ci
```

The `quality` workflow runs the same gates on every push and PR, plus
actionlint and the `isolation` job: a PostgreSQL 17 service built from zero by
the migration runner, every SQL suite, the real-database auth and estimate
integration tests, the preflight gate, an idempotent re-migration, and refusal
of cross-environment runs. It needs no secret and cannot silently skip.

Promotion is an explicit, recorded approval gated by `npm run promotion:check`
(`docs/RELEASE_PROMOTION.md`) until branch protection is available.

## 5. Releases

- `v0.1.0` is the first production-distribution snapshot.
- Pushing a `v*` tag runs `.github/workflows/release.yml`: full verification,
  Docker builds for both apps, GitHub Release with generated notes.
- `CHANGELOG.md` is authoritative per release.

## 6. Production readiness checklist (per promotion)

- [ ] `npm run promotion:check -- <sha>` prints OK for the exact commit
- [ ] `db:preflight --app-env=...` PASS for the target (schema, roles, RLS, ACL, env contract)
- [ ] Migrations applied to the target before the deploy
- [ ] `scripts/anonymous-denial.mjs <host>` (then `--mutations`) all denied after deploy
- [ ] `/api/health` 200 on both apps (`checks.schema` true, `outboxWithinSlo` true, `deadOutboxMessages` 0)
- [ ] `RESEND_API_KEY` still unset until the P0.2 hold is lifted
- [ ] GA gates reviewed: `docs/assurance/REMEDIATION_STATUS.md` and the legal gate

## 7. Runtime contract (P4.3)

| Concern | Contract |
|---|---|
| Node | 22.x everywhere: `.nvmrc`, root `engines`, CI `node-version-file`, `node:22-alpine` images |
| TLS | `pgConnectionConfig()`: `sslmode`/`channel_binding` stripped; full certificate + hostname verification off loopback |
| Connections (Fly) | one pool per process on the direct endpoint, `DATABASE_POOL_MAX` default 10 (control 5); machines × pool ≤ compute `max_connections` minus operator headroom |
| Connections (Vercel) | pooled endpoint (transaction mode is safe: all work is one BEGIN..COMMIT with `SET LOCAL`), default pool 3 (control 2), 5 s idle; instances × pool ≤ pooler client limit |
| Photos | private S3-compatible bucket (`STORAGE_S3_*`); a local `STORAGE_DIR` only with an explicit Fly volume; Vercel refuses local storage |
| Health | `/api/health` = readiness (DB + latest schema + outbox signals); `/api/health?probe=live` = liveness, no DB |
| Outbox | drain claims fenced, tenant-fair batches within a 45 s budget; SLO `OUTBOX_PENDING_SLO_SECONDS` (900). The daily Vercel cron cannot meet that SLO — schedule it every 5 minutes (needs a Vercel plan with sub-daily cron) or run the drain on a Fly scheduled machine before enabling email |
| Logs | JSON lines with request/tenant ids; secrets, bearer links and URL credentials are redacted in `logger` and all `console.*` |

**Load proof still to run on the deployed topology** (cannot be produced from
CI): drive the product at the expected peak with `max machines × pool` and
record `pg_stat_activity` counts on the Neon compute; attach to the release.
