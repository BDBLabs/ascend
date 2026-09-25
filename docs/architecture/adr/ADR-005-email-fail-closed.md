# ADR-005: Outbound Email Fails Closed Until Delivery Is Durable

- **Status:** Accepted
- **Date:** 2026-09-25
- **Scope:** Estimate/notification delivery (`RESEND_API_KEY`, transactional outbox, Vercel cron)
- **Decision type:** Operational architecture

## Context

Estimate delivery rides a transactional outbox drained by
`/api/cron/transactional-outbox` (daily 08:00, `apps/product/vercel.json`).
The assurance review found known data-loss/stall behavior in the worker
(unreclaimed expired claims, missing claim token/version discipline,
best-effort compensating cleanup) — P3.3. Enabling a real email provider on
top of a lossy worker would silently drop customer-facing commercial
documents while reporting success.

## Decision

**No `RESEND_API_KEY` in any environment until sender/domain/recipient
policy is approved *and* delivery/outbox remediation (P3.2 atomic delivery,
P3.3 recoverable worker) is complete.** Until then, estimate email paths
fail closed — they refuse to queue rather than enqueue unsafely. This is
P0.2, and adding the key early is a GA-blocking violation, not a shortcut.

The durable end state (P3): a delivery record per send; one tenant
transaction binding estimate version, revoking previous grants, issuing
view/sign grants, and enqueueing the outbox payload with the delivery ID as
provider idempotency key and audit correlation ID; a worker that reclaims
expired claims, honors retryable-vs-terminal errors, drains in bounded
per-tenant-fair loops against an SLO, and alerts on backlog/lease/dead-row/
provider-auth/cron-miss conditions.

## Alternatives considered

### Enable email now, harden the worker later

**Rejected.** Silent loss of commercial documents is worse than no email:
the sender believes the customer was notified. Fail-closed preserves truth.

### Synchronous provider send in the request path

**Rejected.** Couples web latency and availability to the email provider
and loses idempotency/audit correlation; the outbox pattern is correct,
it just needs to be finished.

## Consequences

### Positive

- No customer is ever told (implicitly) an estimate was sent when it was not.
- The P3 exit evidence (fault-injection matrix, duplicate-cron test,
  backlog/fairness test, real approved-provider delivery) has a clean gate.

### Negative

- Product ships without email notifications until P3 closes — a visible
  feature gap, consciously chosen.
- The cron endpoint and worker code exist but must stay unwired to a provider.

## Status

Accepted. Implemented as configuration policy (key absent everywhere,
fail-closed code paths); worker hardening tracked as P3.2/P3.3.
