# Ascend — Production Deployment Guide

`v0.1.0` snapshot, verified 2026-09-25 via `npm run verify:ci`
(`secrets:check`, lint, workspace tests, `build:all`, production audit).
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
   **Never set it where real tenant data lives.** Production processes
   additionally require `FIELD_DEMO_ALLOW_IN_PRODUCTION=1` or the demo
   principal is refused (fail-closed, warn-logged).
4. `RESEND_API_KEY` intentionally unset until delivery/outbox remediation
   completes — estimate email fails closed rather than queuing unsafely (P0.2).
5. `CONTROL_API_TOKEN` (min 16 chars), `FIELD_PROVISION_SECRET` (endpoint 503s
   without it), `CRON_SECRET` (cron bearer), `FIELD_AUTH_SECRET` (min 32 chars)
   must all be set from the secret manager — never committed.

## 3. Database

```bash
npm run db:migrate   # owner credential, migrations only
npm run db:status    # applied-migration inventory
npm run db:verify    # six isolation suites (RLS, outbox, adversarial)
npm run db:seed:dev  # development tenants only, never production
```

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

The `quality` workflow runs the same gates on push/PR. DB isolation
verification runs whenever `VERIFY_DATABASE_URL_OWNER` (a DISPOSABLE branch
owner credential — never production) is configured.

## 5. Releases

- `v0.1.0` is the first production-distribution snapshot.
- Pushing a `v*` tag runs `.github/workflows/release.yml`: full verification,
  Docker builds for both apps, GitHub Release with generated notes.
- `CHANGELOG.md` is authoritative per release.

## 6. Production readiness checklist (per promotion)

- [ ] `verify:ci` green on the exact deployed commit
- [ ] Separate Neon branch per environment; runtime is not owner, no BYPASSRLS
- [ ] Every env file carries its stamped `ENVIRONMENT`; production migration
  acknowledgement (`ALLOW_PRODUCTION_DB_MUTATION=1`) never persisted in a file
- [ ] `FIELD_DEMO_MODE` unset in production (acknowledgement key only on sandboxes)
- [ ] `RESEND_API_KEY` still unset until P0.2 exit evidence exists
- [ ] `/api/health` 200 on both apps; cron secret configured; outbox draining
- [ ] GA gates reviewed: `REMEDIATION_PLAN.md`, `ISSUES.md`, legal review
