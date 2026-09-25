# ADR-006: Deployment Topology — Fly for Apps, Vercel for Cron, Standalone Builds From Root

- **Status:** Accepted
- **Date:** 2026-09-25
- **Scope:** `fly.product.toml`, `fly.control.toml`, `apps/*/Dockerfile`, `apps/product/vercel.json`
- **Decision type:** Deployment architecture

## Context

The platform needs long-lived servers (connection pooling, per-transaction
role assumption, stable backends) plus one scheduled job (outbox drain).
Serverless-per-request execution fights the pooling design; a single host
for everything leaves the cron story implicit.

## Decision

- **Product** (`jbox-product`, iad) and **Control** (`jbox-control`, iad)
  deploy to Fly from the **repository root** — the Docker build context must
  include the workspace lockfile and `packages/*`. Images run Next
  `standalone` output as non-root (`nextjs`), `NODE_ENV=production`,
  health-checked at `/api/health`, with one machine kept running
  (`min_machines_running = 1`; Fly must not stop idle machines and
  reintroduce cold starts).
- **Cron** stays on Vercel: `apps/product/vercel.json` schedules
  `/api/cron/transactional-outbox` daily 08:00, bearer-guarded by
  `CRON_SECRET` (timing-safe check, tested in `cron-auth.test.ts`).
- Co-location with the database (iad / aws-us-east-1) is prioritized over
  edge proximity: every request makes several Postgres round trips.
- Tag pushes (`v*`) run full verification plus Docker builds for both apps
  (`.github/workflows/release.yml`) before the GitHub Release.

## Alternatives considered

### Everything on Vercel

**Rejected.** Per-request serverless execution stacks connection churn on
top of Neon's pooler and fights the single-pool design documented in
`db.ts`; the predecessor's cold-start/dropped-background-work problems
were part of the reason for the move.

### Everything on Fly including cron

**Rejected.** Fly Machines can do scheduled work, but the Vercel cron
binding already exists and is tested; migrating it adds risk for no
capability gain. Revisit if Vercel's duplicate-delivery/no-retry semantics
(P3.3) prove unmanageable — the worker must tolerate both regardless.

### Per-app build contexts (not repo root)

**Rejected.** The workspace lockfile and `packages/*` links would be
outside the context, breaking reproducible monorepo installs inside the
image.

## Consequences

### Positive

- Long-lived pooled servers where pooling matters; managed cron where a
  managed scheduler suffices.
- Release pipeline proves both Dockerfiles on every tag.

### Negative

- Two platforms to operate (Fly + Vercel) with two failure domains.
- Root-context Docker builds ship the whole workspace to the builder on
  every deploy (mitigated by `.dockerignore`).

## Status

Accepted. Implemented (`v0.1.0` verified: both images' Dockerfiles build in
release CI, both production builds green locally); preview promotion and
connection-budget proof remain P4.2/P4.3.
