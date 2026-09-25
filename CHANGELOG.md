# Changelog — Ascend (BDBLabs/ascend)

Monorepo (`ascend` workspaces): `apps/product`, `apps/control`,
`packages/*`. Format follows Keep a Changelog. Tags: `v0.1.0`.

## [Unreleased] - GA remediation

Implements `docs/assurance/REMEDIATION_PLAN.md` in code; status, evidence and
the remaining operator actions are in `docs/assurance/REMEDIATION_STATUS.md`.
Still **not GA**: P0/P1 need deployed re-verification and the legal gate needs
counsel sign-off.

### Security
- P0.1: production deployments refuse to start with demo-principal variables;
  in-process and deployable anonymous-denial matrices.
- P1.1: no database function is executable by PUBLIC; explicit per-role grants
  and secure default privileges (034), with a positive/negative ACL suite.
- P1.3: environment identity (endpoint registry + database stamp) enforced by
  every tool and both apps; explicit verify-full TLS.
- P2: version-bound sessions (no revivable tokens), working replay-safe MFA,
  lockout, password policy, reset tokens; staff provisioning moved to audited
  control-plane operator actions (`/api/auth/register` and
  `FIELD_PROVISION_SECRET` removed).
- Removed the anonymous organization-creation endpoint (`jbox-setup`).
- Dispatch tickets tenant-bound with hashed tracking tokens (033).
- Custom domains verified only by a DNS TXT record with a stored token (036).
- Logs redact credentials, bearer links and URL passwords.

### Fixed
- Issued invoices were editable and issue/pay/cancel failed (032).
- `ai_conversations`/`ai_messages` RLS was not forced (032).
- Customer estimate page and decision route failed on every request (`AS grant`).
- Signing failed for customers without a phone number.
- Migration runner could not bootstrap a fresh database.

### Added
- P3: immutable, self-verifying signed-estimate evidence rendered on read;
  atomic, version-bound estimate delivery and customer decisions (037).
- P3.3: fenced, tenant-fair, recoverable outbox with SLO signals (032).
- P4: private S3-compatible photo storage; image validation by content;
  pre-promotion `db:preflight`; liveness probe; serverless pool budget.
- P5: named control operators, audit endpoint, per-tenant health, customer-link
  revocation, onboarding quota (038); `docs/RUNBOOKS.md`.
- CI: actionlint; secret-free PostgreSQL 17 isolation job with real-database
  integration tests; release reuses the gate; `promotion:check`.

### Operator actions required before GA
See `docs/assurance/REMEDIATION_STATUS.md` ("Operator" rows).

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
