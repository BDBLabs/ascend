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

## 7. Phase 2 — work packages (migration `025`, committed)

- `work_packages`: one project (direct FK, CASCADE), name/category/
  description, `budget_cost_cents` + `contract_value_cents` (integer
  cents), planned/actual start/finish, status
  (`not_started|in_progress|complete|on_hold|cancelled`),
  `percent_complete` 0–100, responsible person, notes.
- Completion equivalence CHECK: complete ⇔ 100%, so Phase 5 progress
  math can trust the column.
- `work_package_elevators`: package↔unit links (project-wide packages
  simply have no links), mirroring the `project_elevators` pattern.
- `work_package_events`: append-only (`reject_mutation()` trigger) log
  of `created|status_changed|progress_changed|note_added` with actor +
  meta — the progress audit foundation.
- Server modules: `lib/ascend/work-package-contract.ts`,
  `lib/ascend/work-packages.ts` (CRUD, unit links,
  `recordWorkPackageProgress` which updates + appends the event, and
  skips the event write on no-ops). Records extended in
  `ascend-records.ts`.
- Deferred as instructed: earned value, forecasting, billing (Phases
  5–6); terminal-state rules for cancelled packages (Phase 5).

## 8. Phase 3 — project costs (migration `026`, committed)

- `project_cost_entries`: one ledger with `cost_kind`
  (budget|actual|committed|forecast) × `cost_category`
  (material|labor|subcontract|freight|engineering|permits|testing|other),
  integer-cent amounts, optional project/elevator/package links (unit and
  package links SET NULL on delete so the money trail survives),
  cost date, source ref, actor, description.
- Labor is first-class: integer-hundredths hours + integer-cent rates,
  amount authoritative; `recordLaborCost` derives it half-up in integer
  arithmetic. Burden is carried in the rate (no separate multiplier yet).
- Posted `actual` rows are immutable via
  `restrict_posted_cost_mutation()` trigger — corrections are new
  entries. Budget/committed/forecast stay revisable as planning figures;
  committed-amendment history is a Phase 6 open item.
- Server modules: `lib/ascend/project-cost-contract.ts`,
  `lib/ascend/project-costs.ts` (`recordCostEntry`,
  `recordLaborCost`, filtered lists, `summarizeProjectCosts` with
  PostgreSQL-side GROUP BY rollups into per-lens totals).
- Deferred as instructed: earned value / margin math (Phase 5),
  billing integration (Phase 6).

## 9. Phase 4 — project parts / procurement (migration `027`, committed)

- `project_parts`: requirement/consumption rows per project, optional
  building/elevator/package pins and optional `inventory_items` link.
  Quantities in hundredths (ledger convention), planned vs actual
  integer cents, supplier, PO ref, needed date. The inventory catalog
  and stock ledger are untouched — workflow state lives here.
- `project_part_events`: append-only (`reject_mutation()`) log of
  created/status/quantity/note events with actor + meta — the
  receiving, allocation, and installation trail.
- Lifecycle in contract: forward-only chain with legal forward jumps
  (off-the-shelf buys), `returned`/`cancelled` exits, terminal states
  final. Quantity/cost moves are upward-only (corrections by note).
- Server modules: `lib/ascend/project-part-contract.ts`,
  `lib/ascend/project-parts.ts` (`createProjectPart`,
  `updatePartStatus`, `recordPartQuantity`, filtered lists).
- Deferred as instructed: stock decrement on install and PO-level
  committed-cost linkage (Phases 5–6).

## 10. Phase 1 scope guardrails

- Additive migration only. No edits to `001`–`023`, no J-Box UI/route
  changes, no global renames.
- Server-side data-access in `apps/product/src/lib/` following the
  existing `jobs.ts`/`estimates.ts` pattern (`server-only`, `db()`,
  row-mapper, bounded list filters); unit tests mock `@/lib/db` like
  `jobs.test.ts`.
- `LATEST_MIGRATION` in `packages/database/src/index.ts` advances to
  `024_ascend_domain_foundation.sql`.
