# Ascend Domain Model (Phase 1 — Domain Foundation)

Branch: `feat/ascend-domain-foundation`. Status: proposal + foundation tables only.
The J-Box UI, routes, and lifecycle (`/jbox`, `/field`, estimates → jobs → invoices)
are unchanged. Nothing below renames or deletes existing behavior.

## 1. Phase 0 baseline (recorded before any Ascend change)

- `npm test`: 266/267 pass. One pre-existing failure:
  `apps/product/src/lib/customer-estimate-decision.test.ts >
  decideCustomerEstimate validation > accepts decline whether
  affirmativeConsent is true or false`.
- `npm run lint`: 14 pre-existing `no-unused-vars` errors in
  `@contractor-platform/product` (unused imports/symbols in AI tools,
  change-order and settings pages).
- `npm run build`: pre-existing failures — `field.module.css` and
  `../jbox-tokens` unresolvable, plus `@contractor-platform/ai/agent`
  subpath not exported. Phase 1 must not be gated on fixing these, and
  must not make them worse.

## 2. J-Box inventory (what we preserve)

Database: 23 migrations (`001`–`023`), ~44 tables. Platform capabilities
that survive untouched: `organizations` + RLS/`FORCE RLS` + `contractor_app`
role model (`001`), integer-cent money path (`packages/money`),
versioned/immutable configuration (`configuration_versions`), published
price-book releases (`price_book_*`), transactional outbox + idempotency
keys, append-only ledgers (`inventory_transactions`, `job_snapshots`),
AI actor/tool audit (`ai_actors`, `ai_tool_audit_events`).

Commercial lifecycle today:

- `customers` → `estimates` (+ `estimate_line_items`, `estimate_events`)
  → `jobs` (one-job-per-estimate, `011`) → `invoices`
  (+ `invoice_line_items`, `invoice_events`)
- `change_orders` (+ lines/events) guarded on signed estimate + live job
- `inventory_items` / `inventory_transactions` (append-only stock ledger,
  no app writer — schema + checks only) and `job_materials`
- Services: `apps/product/src/lib/{customers,estimates,estimate-jobs,
  jobs,invoices,change-orders,price-book}.ts` (+ `-contract` validators,
  `-record` row mappers). Tests mock `@/lib/db`.
- UI routes: `/jbox/*` (jobs, estimates, invoices, customers,
  change-orders, price-book, ai), `/field/*` (estimates, customers,
  invoices/[id], login, storefront, settings), `/platform/*`, public
  estimate token pages, storefront/dispatch groups. API: 51 product
  routes + 6 control routes (see task inventory).

## 3. Ascend operational model

Customer → Building/Site → Elevator Unit → Modernization Project →
Contract/Scope → Work Packages → Parts/Procurement → Labor/Costs →
Progress → Billing.

A customer owns/manages many buildings; a building has many units; a
project spans one or more units (usually within one building, but the
join table does not force it).

## 4. Phase 1 entities (this migration: `024`)

| Table | Grain | Key parents |
|---|---|---|
| `buildings` | site | `customers(id, organization_id)` RESTRICT |
| `elevator_units` | car | `buildings(id, organization_id)` CASCADE |
| `modernization_projects` | project | `customers` RESTRICT; `buildings` SET NULL (project survives site-record rework, keeps customer) |
| `project_elevators` | project↔unit link | both sides CASCADE |

`modernization_projects.status`: `prospect | bidding | awarded |
in_progress | substantially_complete | closed | cancelled`. Existing
`jobs.status` values are untouched; no mapping is asserted yet — the
jobs-table-reuse decision is deferred to Phase 2 after work packages
exist (see §6).

Money in Phase 1: only `contract_value_cents` (non-negative integer,
server-authoritative, consistent with the money package). Budget/actual/
committed/forecast/progress/billing fields arrive in Phases 3–6; the
column is deliberately singular so no premature accounting semantics
are baked in.

Elevator technical data uses structured nullable columns (manufacturer,
model, serial, type, load, speed, stops, controller/drive/door-operator
manufacturers + models, condition) — not a JSON blob — per the product
rule that reportable data stays queryable. Extra fields can be added
later via additive migrations.

## 5. Tenant-isolation contract (every new table)

Follows `001`/`004` conventions exactly: `organization_id uuid NOT
NULL DEFAULT app_require_organization_id()` + tenant-scoped composite
FKs `(id, organization_id)` with `UNIQUE (id, organization_id)` on each
parent, `ENABLE` + `FORCE ROW LEVEL SECURITY`, one
`<table>_tenant_isolation` policy `FOR ALL TO contractor_app`, grants
to `contractor_app`, indexes leading with `organization_id`.

## 6. Open questions (deferred, not decided here)

1. `jobs` reuse: can `modernization_projects` wrap (rather than replace)
   `jobs` as the execution workhorse once work packages exist? Phase 2.
2. Estimate linkage: project↔estimate association shape (Phase 2/5).
3. `document_number`/`display_id` prefixes for Ascend documents
   (`configuration_versions` `DocumentPrefixes` currently has
   customer/estimate/serviceRequest/job/invoice/receipt/changeOrder).
4. Multi-building projects: allowed by schema; product policy undecided.
5. Contractual-obligation tracing (contract → milestone → activity →
   evidence): identifiers (`project`, future `contract`, future
   `work_package`, events) are UUID-stable to support it; not built.

## 7. Phase 1 scope guardrails

- Additive migration only. No edits to `001`–`023`, no J-Box UI/route
  changes, no global renames.
- Server-side data-access in `apps/product/src/lib/` following the
  existing `jobs.ts`/`estimates.ts` pattern (`server-only`, `db()`,
  row-mapper, bounded list filters); unit tests mock `@/lib/db` like
  `jobs.test.ts`.
- `LATEST_MIGRATION` in `packages/database/src/index.ts` advances to
  `024_ascend_domain_foundation.sql`.
