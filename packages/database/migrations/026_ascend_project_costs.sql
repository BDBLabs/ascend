-- 026_ascend_project_costs.sql
--
-- Ascend Phase 3 — project costs (additive only).
--
-- One cost-entry ledger distinguishes the four cost lenses every later
-- phase needs:
--
--   budget    the plan (revisable; work-package budgets + explicit lines)
--   actual    posted facts from invoices, timesheets, receipts (immutable)
--   committed signed obligations not yet paid (revisable for now; amendment
--             history is a Phase 6 open item)
--   forecast  the current expected final, revised as the job unfolds
--
-- Labor is a first-class entry, not a generic line: hours are stored as
-- integer hundredths and the rate as integer cents per hour, so no
-- floating-point value ever enters the money path. The recorded
-- amount_cents is authoritative; hours/rate are the evidence behind it.
--
-- Posted actuals cannot be updated or deleted (trigger below):
-- corrections are new entries, so commercially meaningful history is
-- never silently overwritten. Budget/committed/forecast rows stay
-- editable because they are planning figures by nature.
--
-- Tenant-isolation contract per 001/004: organization_id defaulting to
-- app_require_organization_id(), composite tenant-scoped foreign keys,
-- ENABLE + FORCE RLS, one contractor_app policy.

CREATE TABLE IF NOT EXISTS project_cost_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  project_id uuid NOT NULL,
  elevator_unit_id uuid,
  work_package_id uuid,

  cost_kind text NOT NULL
    CHECK (cost_kind IN ('budget', 'actual', 'committed', 'forecast')),
  cost_category text NOT NULL
    CHECK (cost_category IN ('material', 'labor', 'subcontract', 'freight',
                             'engineering', 'permits', 'testing', 'other')),

  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),

  labor_hours_hundredths bigint
    CHECK (labor_hours_hundredths IS NULL OR labor_hours_hundredths > 0),
  labor_rate_cents_per_hour bigint
    CHECK (labor_rate_cents_per_hour IS NULL OR labor_rate_cents_per_hour >= 0),

  cost_date date NOT NULL,
  source_type text NOT NULL DEFAULT '' CHECK (char_length(source_type) <= 60),
  source_ref text NOT NULL DEFAULT '' CHECK (char_length(source_ref) <= 200),
  actor_id uuid,
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (project_id, organization_id)
    REFERENCES modernization_projects (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (elevator_unit_id, organization_id)
    REFERENCES elevator_units (id, organization_id) ON DELETE SET NULL,
  FOREIGN KEY (work_package_id, organization_id)
    REFERENCES work_packages (id, organization_id) ON DELETE SET NULL,
  -- Labor evidence travels together: hours without a rate (or vice versa)
  -- cannot be interpreted later, so both must be present or both absent.
  CHECK ((labor_hours_hundredths IS NULL) =
         (labor_rate_cents_per_hour IS NULL))
);

-- migrate:split

CREATE INDEX IF NOT EXISTS project_cost_entries_org_project_idx
  ON project_cost_entries (organization_id, project_id, cost_kind, cost_category);

-- migrate:split

CREATE INDEX IF NOT EXISTS project_cost_entries_org_project_date_idx
  ON project_cost_entries (organization_id, project_id, cost_date DESC);

-- migrate:split

CREATE INDEX IF NOT EXISTS project_cost_entries_org_package_idx
  ON project_cost_entries (organization_id, work_package_id, cost_date DESC);

-- migrate:split

-- Posted actuals are facts: they can be superseded by new entries but
-- never edited or removed in place. Planning figures (budget, committed,
-- forecast) remain revisable.
CREATE OR REPLACE FUNCTION restrict_posted_cost_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.cost_kind = 'actual' THEN
    RAISE EXCEPTION 'Actual cost entries are immutable; record a correcting entry instead.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- migrate:split

CREATE TRIGGER project_cost_entries_posted_immutable
  BEFORE UPDATE OR DELETE ON project_cost_entries
  FOR EACH ROW
  EXECUTE FUNCTION restrict_posted_cost_mutation();

-- migrate:split

-- ── Row-level security ──────────────────────────────────────────────

ALTER TABLE project_cost_entries ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE project_cost_entries FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY project_cost_entries_tenant_isolation ON project_cost_entries
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON project_cost_entries
  TO contractor_app;
