# ADR-003: Demo Mode Is Fail-Closed on Production Processes

- **Status:** Accepted
- **Date:** 2026-09-25
- **Scope:** Field auth (`apps/product/src/lib/field-api-auth.ts`), deployment env contract
- **Decision type:** Security architecture

## Context

`FIELD_DEMO_MODE=1` plus `DEVELOPMENT_FIELD_ORGANIZATION_ID` resolves a
synthetic OWNER principal for requests without a valid JWT — the deliberate
opt-in that makes the Field UI explorable without an identity provider. The
2026-08-14 assurance snapshot found this combination live in Production,
anonymously exposing tenant Field data with owner rights (P0.1). Docs alone
did not prevent it.

## Decision

The demo principal is **fail-closed on production processes**: with
`NODE_ENV=production`, `resolveDevelopmentFieldPrincipal()` returns null
(callers 401) unless *both* `FIELD_DEMO_MODE=1` *and* the explicit
acknowledgement `FIELD_DEMO_ALLOW_IN_PRODUCTION=1` are set — and the second
key belongs only on sandbox deployments holding no real tenant data. The
refusal is warn-logged once per process. Demo mode also requires
`FIELD_DEMO_MODE=1` in non-production (org-id alone no longer suffices).

Operational companion (still required per P0.1): strip both demo variables
from Product Production, redeploy the exact commit, and prove anonymous
denial across every Field route including forged-Origin requests.

## Alternatives considered

### Docs-only prohibition

**Rejected.** This was the prior posture and it produced the P0.1 incident.

### Fail-fast at startup (refuse to boot with demo vars in prod)

**Rejected for now.** Crashing the deployment breaks health checks and JWT
users along with the demo path; per-request refusal contains the blast
radius to the demo principal while keeping the app serving. Revisit if a
startup assertion framework lands.

### Remove demo mode entirely

**Rejected.** Local/seeded development (`db:seed:dev`) genuinely needs a
zero-IdP path; the risk is production carriage, not existence.

## Consequences

### Positive

- An accidentally-carried demo variable cannot expose a tenant workspace.
- The two-key rule makes production demo use a conscious, auditable act.

### Negative

- Sandbox prod-mode demos need two variables; a forgotten acknowledgement
  fails as denied access (safe direction, but confusing without the log).
- Does not retroactively cover the exposure window — the incident decision
  in P0.1 is still owed.

## Status

Accepted. Implemented with 6 tests (`src/lib/field-api-auth.test.ts`);
contract in `.env.example`; checklist in `DEPLOYMENT.md` §6.
