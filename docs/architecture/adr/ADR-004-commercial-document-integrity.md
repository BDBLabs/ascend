# ADR-004: Commercial Document Integrity — Cents, Publication Gates, Immutable Config, Approved Claims

- **Status:** Accepted
- **Date:** 2026-09-25
- **Scope:** Pricing, estimates, invoices, rendered customer documents (`packages/money`, `packages/domain`, estimate/invoice libraries)
- **Decision type:** Domain architecture

## Context

Estimates, invoices, and receipts are commercial instruments: a rounding
error, a draft price leaking into a signed document, a re-rendered total
under changed configuration, or an unapproved license claim each create
contractual or regulatory exposure for the contractor — and liability for
the platform.

## Decision

Four coupled invariants, all server-authoritative:

1. **Money is integer cents.** No floats anywhere in the pricing path
   (`packages/money`). Rounding happens once, explicitly, at defined
   boundaries.
2. **Unpublished pricing cannot enter a commercial document.** Draft/price-book
   states that are not published are unreachable from estimate/invoice
   generation paths.
3. **Configuration is versioned and immutable.** Changes create a new
   version rather than mutating the live document, so a rendered estimate
   ties to the exact configuration in force when it was issued — re-renders
   and audits are reproducible.
4. **Regulatory claims are approval-flagged.** A license or insurance
   statement renders only when the tenant has affirmatively approved its
   text. The platform never publishes a claim on a contractor's behalf by
   default.

## Alternatives considered

### Float pricing with display rounding

**Rejected.** Binary-float representation error in money math is a classic,
unbounded source of penny disputes; integer cents removes the class.

### Live-config rendering (always current terms)

**Rejected.** Destroys reproducibility: a customer disputing last month's
estimate would see today's terms. Immutability costs storage, not truth.

### Platform-default license/insurance display

**Rejected.** Publishing a regulatory claim the contractor never approved
exposes both parties; the approval flag keeps authority with the
contractor (the platform's governing design constraint).

## Consequences

### Positive

- Estimates/invoices are defensible: exact cents, exact config version,
  approved claims only.
- Dispute resolution reduces to showing the frozen inputs.

### Negative

- Config versioning adds storage and lookup complexity on every render path.
- Approval-flag UX adds a step to contractor onboarding (tenant must
  affirmatively approve claim text).

## Status

Accepted. Implemented per README principles; signed-estimate evidence
persistence and atomic delivery remain P3 hardening.
