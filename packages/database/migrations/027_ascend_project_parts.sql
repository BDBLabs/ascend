-- 027_ascend_project_parts.sql
--
-- Ascend Phase 4 — project parts / procurement (additive only).
--
-- The existing inventory tables are untouched: inventory_items stays the
-- catalog and inventory_transactions stays the append-only stock ledger.
-- Project workflow state lives here, in project_parts, so the ledger is
-- never overloaded with procurement lifecycle.
--
-- A project part is a requirement (or consumption) of a specific project,
-- optionally pinned to building / elevator / work package and optionally
-- linked to a catalog inventory_item. Quantities use hundredths, matching
-- the inventory ledger's unit convention. Money is integer cents:
-- planned_cost_cents (expected) vs actual_cost_cents (posted).
--
-- Lifecycle: specified -> ordered -> shipped -> received -> allocated ->
-- installed, with returned and cancelled as exits. Forward jumps are
-- allowed (e.g. off-the-shelf specified -> received); the transition
-- rule lives in the application contract, and every change appends an
-- immutable project_part_events row.
--
-- Tenant-isolation contract per 001/004: organization_id defaulting to
-- app_require_organization_id(), composite tenant-scoped foreign keys,
-- ENABLE + FORCE RLS, one contractor_app policy per table.

CREATE TABLE IF NOT EXISTS project_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  project_id uuid NOT NULL,
  building_id uuid,
  elevator_unit_id uuid,
  work_package_id uuid,
  inventory_item_id uuid,

  description text NOT NULL CHECK (char_length(description) BETWEEN 2 AND 500),
  quantity_required_hundredths bigint NOT NULL CHECK (quantity_required_hundredths > 0),
  quantity_received_hundredths bigint NOT NULL DEFAULT 0
    CHECK (quantity_received_hundredths >= 0),
  quantity_installed_hundredths bigint NOT NULL DEFAULT 0
    CHECK (quantity_installed_hundredths >= 0),

  status text NOT NULL DEFAULT 'specified'
    CHECK (status IN ('specified', 'ordered', 'shipped', 'received',
                      'allocated', 'installed', 'returned', 'cancelled')),

  planned_cost_cents bigint NOT NULL DEFAULT 0 CHECK (planned_cost_cents >= 0),
  actual_cost_cents bigint NOT NULL DEFAULT 0 CHECK (actual_cost_cents >= 0),

  supplier text NOT NULL DEFAULT '' CHECK (char_length(supplier) <= 200),
  source_ref text NOT NULL DEFAULT '' CHECK (char_length(source_ref) <= 200),
  needed_date date,
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (project_id, organization_id)
    REFERENCES modernization_projects (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (building_id, organization_id)
    REFERENCES buildings (id, organization_id) ON DELETE SET NULL,
  FOREIGN KEY (elevator_unit_id, organization_id)
    REFERENCES elevator_units (id, organization_id) ON DELETE SET NULL,
  FOREIGN KEY (work_package_id, organization_id)
    REFERENCES work_packages (id, organization_id) ON DELETE SET NULL,
  FOREIGN KEY (inventory_item_id, organization_id)
    REFERENCES inventory_items (id, organization_id) ON DELETE SET NULL
);

-- migrate:split

CREATE INDEX IF NOT EXISTS project_parts_org_project_idx
  ON project_parts (organization_id, project_id, status);

-- migrate:split

CREATE INDEX IF NOT EXISTS project_parts_org_package_idx
  ON project_parts (organization_id, work_package_id, status);

-- migrate:split

CREATE INDEX IF NOT EXISTS project_parts_org_unit_idx
  ON project_parts (organization_id, elevator_unit_id, status);

-- migrate:split

-- ── Part events (append-only) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_part_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  project_part_id uuid NOT NULL,
  event text NOT NULL
    CHECK (event IN
      ('created', 'status_changed', 'quantity_updated', 'note_added')),
  actor_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (project_part_id, organization_id)
    REFERENCES project_parts (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS project_part_events_part_created_idx
  ON project_part_events (project_part_id, created_at DESC, id DESC);

-- migrate:split

CREATE TRIGGER project_part_events_append_only
  BEFORE UPDATE OR DELETE ON project_part_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- ── Row-level security ──────────────────────────────────────────────

ALTER TABLE project_parts ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE project_parts FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE project_part_events ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE project_part_events FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY project_parts_tenant_isolation ON project_parts
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY project_part_events_tenant_isolation ON project_part_events
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON project_parts, project_part_events
  TO contractor_app;
