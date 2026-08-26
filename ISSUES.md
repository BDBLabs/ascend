# GitHub Issues

## Issue 1: CRITICAL — Storefront request form sends wrong field names to API
**Labels:** bug, critical, storefront
**Description:**
The storefront `RequestForm` component sends `serviceCategory`, `workRequired`, and `siteLocation`, but `POST /api/requests` expects `serviceSlug`, `summary`, and `serviceAddress`. The `summary` field is required server-side, so every form submission fails with "a short summary is required".

**Affected files:**
- `apps/product/src/app/(storefront)/request/request-form.tsx`
- `apps/product/src/app/api/requests/route.ts`

**Fix:** Align field names — form uses `serviceCategory` (matches select value which IS the slug), `workRequired` → `summary`, `siteLocation` → `serviceAddress`.

---

## Issue 2: No /track link in storefront navigation
**Labels:** enhancement, storefront
**Description:**
The storefront layout header renders Home, Services, Request a quote — but no link to `/track`. Customers who receive a tracking code have no way to discover the tracking page.

**Fix:** Add "Track" link to `site-nav` in `(storefront)/layout.tsx`.

---

## Issue 3: No viewport meta tag (P0 mobile break)
**Labels:** bug, critical, mobile
**Description:**
The root layout `apps/product/src/app/layout.tsx` has no `<meta name="viewport">` tag. Every page renders at desktop width on mobile browsers, forcing pinch-to-zoom.

**Fix:** Add viewport metadata to root layout `Metadata` export.

---

## Issue 4: J-Box sidebar not collapsible on mobile
**Labels:** bug, high, mobile
**Description:**
The J-Box sidebar is a fixed 256px panel with no hamburger/drawer toggle. On viewports under ~800px, the sidebar consumes most of the screen leaving content inaccessible.

**Fix:** Add a hamburger button and overlay drawer pattern (following `field/mobile-menu-button.tsx`).

---

## Issue 5: All data tables overflow on mobile
**Labels:** bug, high, mobile
**Description:**
All J-Box list pages (jobs, customers, estimates, invoices, price-book) and detail pages render tables with no `overflow-x: auto` wrapper. Tables overflow horizontally on screens under ~700px.

**Fix:** Wrap all `<table>` elements in `<div style={{ overflowX: 'auto' }}>`.

---

## Issue 6: Invoice workflow missing issue/cancel/payment functions
**Labels:** enhancement, high, invoices
**Description:**
The `invoices` library has `createInvoiceFromEstimate` but no `issueInvoice`, `cancelInvoice`, or `recordPayment` functions. The `amount_paid_cents` column and `partially_paid` status exist in DB but no app code writes to them.

**Fix:** Add the missing business logic functions and wire them to API routes and UI.

---

## Issue 7: Change order system has zero API routes or UI
**Labels:** enhancement, high, change-orders
**Description:**
The `change-orders` library has full business logic (create, submit, approve, reject) but zero API routes, zero UI pages, no sidebar nav entry, and no status helpers. The field app links to `/field/estimates/[id]/change-order` which doesn't exist (broken link).

**Fix:** Add API routes, J-Box list/detail pages, status label/color helpers, sidebar entry.

---

## Issue 8: `partially_paid` missing from STATUS_LABELS
**Labels:** bug, medium, jbox
**Description:**
`jbox-tokens.ts` `STATUS_LABELS` map has no entry for `partially_paid`. Invoices with this status display the raw key string instead of a readable label.

**Fix:** Add `partially_paid: 'Partially Paid'` to `STATUS_LABELS` and `STATUS_BG`.

---

## Issue 9: StatusStepper on /track page is static decoration
**Labels:** enhancement, medium, storefront
**Description:**
The `StatusStepper` component renders five identical grey steps regardless of document status. It should highlight the current step.

**Fix:** Pass document status to stepper and apply active/completed styling.

---

## Issue 10: Price-book search input fixed at 280px width
**Labels:** bug, medium, mobile
**Description:**
The price-book search input has `width: '280px'` which overflows on any viewport under ~350px.

**Fix:** Change to `width: '100%', maxWidth: '280px'`.

---

## Issue 11: J-Box card padding too generous on mobile
**Labels:** enhancement, medium, mobile
**Description:**
`card` token has `padding: '32px'`. On 320px viewport this consumes 20% of horizontal space. Needs responsive reduction to 16px.

**Fix:** Reduce padding via media query or conditional token.
