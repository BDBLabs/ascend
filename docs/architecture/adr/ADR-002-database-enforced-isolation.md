# ADR-002: Tenant Isolation Enforced in the Database, Not the Application Layer

- **Status:** Accepted
- **Date:** 2026-09-25
- **Scope:** All tenant data paths (product + control, `packages/database` migrations)
- **Decision type:** Foundational architecture

## Context

The predecessor pointed every environment at one database as the table
owner. Two structural consequences followed: local development wrote to
production, and because the owner holds BYPASSRLS, row-level security was
inert on every unscoped path. Application-layer scoping (`where
organization_id = ...`) fails open the moment one path forgets the clause.

## Decision

**Isolation is a database property.** Row-level security is enabled *and*
forced; the runtime connects as a restricted non-owner login that assumes a
tenant-scoped role per transaction (`contractor_app` for tenant work,
`platform_runtime` for the legitimately cross-tenant paths,
`control_app` for the control plane). Three separate credentials exist by
design: runtime, unpooled/direct, and owner-for-migrations-only
(`DATABASE_URL_OWNER` never ships to a running app). Every environment gets
its own Neon branch; endpoints are never shared between local, preview, and
production (`.env.example` contract, `DATABASE_SETUP.md`).

An application path can forget to enter tenant context; it cannot forget a
database policy. `npm run db:verify` (six isolation suites: RLS, outbox,
adversarial) is part of `verify:ci`.

## Alternatives considered

### Application-layer scoping with code review

**Rejected.** This was the inherited posture and it failed structurally:
one missed clause is a cross-tenant read, and review does not scale across
every future route.

### Single shared database user with RLS but no forcing

**Rejected.** Without forced RLS and a non-bypass login, any owner-path or
misconfigured role silently disables the boundary.

### Per-tenant databases/schemas

**Rejected.** Operational cost (migrations × tenants, connection sprawl,
per-tenant backup/restore) far exceeds the threat model for sub-10-staff
contractors; RLS + branch-per-environment is the proportionate control.

## Consequences

### Positive

- Cross-tenant leakage requires defeating Postgres policy, not forgetting a clause.
- `db:verify` gives a repeatable, CI-runnable proof of the boundary.

### Negative

- Every new table/function must get RLS policy + role grants from its first
  migration (P1.1 extends this to function `REVOKE FROM PUBLIC` + ACL checks).
- Local development needs a real branch + restricted login; `sqlite`-style
  shortcuts are unavailable by design.

## Status

Accepted. Implemented from the first commit; assurance detail in
`docs/assurance/TENANT_ISOLATION.md`; remaining hardening tracked as P1.1/P1.3.
