-- 025_ascend_work_packages.sql
--
-- Ascend Phase 2 — work packages (additive only).
--
-- A work package is the unit of execution inside a modernization project
-- (Engineering, Controller, Installation, Testing, ...). It belongs to
-- exactly one project and optionally scopes to specific elevator units
-- via work_package_elevators; a package with no unit links is
-- project-wide (e.g. Engineering, Permits).
--
-- Progress foundation: status + percent_complete live on the package with
-- a completion-equivalence CHECK, and every meaningful change appends an
-- immutable work_package_events row. Earned value, forecasting, and
-- billing stay in Phases 5-6; this migration only makes progress
-- recordable and auditable.
--
-- Tenant-isolation contract per 001/004: organization_id defaulting to
-- app_require_organization_id(), composite tenant-scoped foreign keys,
-- ENABLE + FORCE RLS, one contractor_app policy per table.

-- ── Work packages ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  project_id uuid NOT NULL,

  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
  category text NOT NULL DEFAULT '' CHECK (char_length(category) <= 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),

  budget_cost_cents bigint NOT NULL DEFAULT 0 CHECK (budget_cost_cents >= 0),
  contract_value_cents bigint NOT NULL DEFAULT 0 CHECK (contract_value_cents >= 0),

  planned_start date,
  planned_finish date,
  actual_start date,
  actual_finish date,

  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'complete',
                      'on_hold', 'cancelled')),
  percent_complete integer NOT NULL DEFAULT 0
    CHECK (percent_complete BETWEEN 0 AND 100),

  responsible_person text NOT NULL DEFAULT ''
    CHECK (char_length(responsible_person) <= 200),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (project_id, organization_id)
    REFERENCES modernization_projects (id, organization_id) ON DELETE CASCADE,
  CHECK (planned_finish IS NULL OR planned_start IS NULL
         OR planned_finish >= planned_start),
  -- Completion is a fact, not a label: a complete package is 100% and a
  -- 100% package is complete. Phase 5 progress math can trust this.
  CHECK ((status = 'complete') = (percent_complete = 100))
);

-- migrate:split

CREATE INDEX IF NOT EXISTS work_packages_org_project_idx
  ON work_packages (organization_id, project_id, created_at);

-- migrate:split

CREATE INDEX IF NOT EXISTS work_packages_org_status_idx
  ON work_packages (organization_id, status, updated_at DESC);

-- migrate:split

-- ── Package ↔ elevator links ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_package_elevators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  work_package_id uuid NOT NULL,
  elevator_unit_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (work_package_id, elevator_unit_id),
  FOREIGN KEY (work_package_id, organization_id)
    REFERENCES work_packages (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (elevator_unit_id, organization_id)
    REFERENCES elevator_units (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS work_package_elevators_package_idx
  ON work_package_elevators (work_package_id, elevator_unit_id);

-- migrate:split

CREATE INDEX IF NOT EXISTS work_package_elevators_unit_idx
  ON work_package_elevators (elevator_unit_id, work_package_id);

-- migrate:split

-- ── Progress events (append-only) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS work_package_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  work_package_id uuid NOT NULL,
  event text NOT NULL
    CHECK (event IN
      ('created', 'status_changed', 'progress_changed', 'note_added')),
  actor_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (work_package_id, organization_id)
    REFERENCES work_packages (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS work_package_events_package_created_idx
  ON work_package_events (work_package_id, created_at DESC, id DESC);

-- migrate:split

CREATE TRIGGER work_package_events_append_only
  BEFORE UPDATE OR DELETE ON work_package_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- ── Row-level security ──────────────────────────────────────────────

ALTER TABLE work_packages ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE work_packages FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE work_package_elevators ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE work_package_elevators FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE work_package_events ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE work_package_events FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY work_packages_tenant_isolation ON work_packages
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY work_package_elevators_tenant_isolation ON work_package_elevators
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY work_package_events_tenant_isolation ON work_package_events
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON work_packages, work_package_elevators, work_package_events
  TO contractor_app;
