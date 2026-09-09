-- 028_ascend_progress_billing.sql
--
-- Ascend Phase 6 — progress billing (additive only).
--
-- A billing layer above the J-Box invoice engine, which is reused
-- unchanged: invoices keep recording issued/paid money, while the
-- commercial billing facts (what was earned, retained, and billed per
-- period) live here.
--
--   billing_schedules  one row per project: the agreed retainage percent
--   billing_periods    numbered progress periods (Application #1, #2, ...)
--   progress_applications  the frozen per-period snapshot: contract and
--                      earned values, previously billed, retainage held,
--                      stored materials, and the current amount due, with a
--                      draft -> submitted -> approved -> invoiced workflow
--                      (rejected returns to submitted for rework)
--   progress_application_events  append-only audit trail with actor + meta
--
-- An approved application links to its invoice (invoice_id); the invoice
-- engine consumes the application's frozen lines, it never computes
-- progress itself. current_due_cents may be negative (credit balance):
-- billing honesty beats a non-negativity CHECK here.
--
-- Tenant-isolation contract per 001/004: organization_id defaulting to
-- app_require_organization_id(), composite tenant-scoped foreign keys,
-- ENABLE + FORCE RLS, one contractor_app policy per table.

-- ── Billing schedules ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  project_id uuid NOT NULL,

  retainage_percent integer NOT NULL DEFAULT 0
    CHECK (retainage_percent BETWEEN 0 AND 100),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  UNIQUE (project_id, organization_id),
  FOREIGN KEY (project_id, organization_id)
    REFERENCES modernization_projects (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

-- ── Billing periods ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  project_id uuid NOT NULL,
  period_number integer NOT NULL CHECK (period_number > 0),
  period_start date NOT NULL,
  period_end date NOT NULL,

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  UNIQUE (project_id, organization_id, period_number),
  FOREIGN KEY (project_id, organization_id)
    REFERENCES modernization_projects (id, organization_id) ON DELETE CASCADE,
  CHECK (period_end >= period_start)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS billing_periods_org_project_idx
  ON billing_periods (organization_id, project_id, period_number);

-- migrate:split

-- ── Progress applications ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS progress_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  billing_period_id uuid NOT NULL,
  project_id uuid NOT NULL,
  invoice_id uuid,

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'invoiced')),

  -- Frozen snapshot, all integer cents. current_due_cents is intentionally
  -- unconstrained in sign: a credit balance is a fact, not an error.
  contract_value_cents bigint NOT NULL CHECK (contract_value_cents >= 0),
  earned_value_cents bigint NOT NULL CHECK (earned_value_cents >= 0),
  previously_billed_cents bigint NOT NULL CHECK (previously_billed_cents >= 0),
  retainage_percent integer NOT NULL CHECK (retainage_percent BETWEEN 0 AND 100),
  retainage_cents bigint NOT NULL CHECK (retainage_cents >= 0),
  stored_materials_cents bigint NOT NULL DEFAULT 0
    CHECK (stored_materials_cents >= 0),
  current_due_cents bigint NOT NULL,

  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  UNIQUE (billing_period_id, organization_id),
  FOREIGN KEY (billing_period_id, organization_id)
    REFERENCES billing_periods (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, organization_id)
    REFERENCES modernization_projects (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id, organization_id)
    REFERENCES invoices (id, organization_id) ON DELETE SET NULL
);

-- migrate:split

CREATE INDEX IF NOT EXISTS progress_applications_org_project_idx
  ON progress_applications (organization_id, project_id, created_at DESC);

-- migrate:split

-- ── Application events (append-only) ────────────────────────────────

CREATE TABLE IF NOT EXISTS progress_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  progress_application_id uuid NOT NULL,
  event text NOT NULL
    CHECK (event IN
      ('created', 'submitted', 'approved', 'rejected', 'invoiced',
       'voided', 'note_added')),
  actor_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (progress_application_id, organization_id)
    REFERENCES progress_applications (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS progress_application_events_app_created_idx
  ON progress_application_events (progress_application_id, created_at DESC, id DESC);

-- migrate:split

CREATE TRIGGER progress_application_events_append_only
  BEFORE UPDATE OR DELETE ON progress_application_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- ── Row-level security ──────────────────────────────────────────────

ALTER TABLE billing_schedules ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE billing_schedules FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE billing_periods ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE billing_periods FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE progress_applications ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE progress_applications FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE progress_application_events ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE progress_application_events FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY billing_schedules_tenant_isolation ON billing_schedules
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY billing_periods_tenant_isolation ON billing_periods
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY progress_applications_tenant_isolation ON progress_applications
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY progress_application_events_tenant_isolation ON progress_application_events
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON billing_schedules, billing_periods,
     progress_applications, progress_application_events
  TO contractor_app;
