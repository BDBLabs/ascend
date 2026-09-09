-- 024_ascend_domain_foundation.sql
--
-- Ascend Phase 1 — domain foundation (additive only).
--
-- Introduces the elevator-modernization hierarchy alongside the existing
-- J-Box model; nothing here alters or renames existing tables:
--
--   customers (existing, commercial account)
--     -> buildings (new: site)
--       -> elevator_units (new: car)
--   modernization_projects (new) ties customer + building to one or more
--   units via project_elevators.
--
-- Every table follows the 001/004 tenant-isolation contract:
-- organization_id defaulting to app_require_organization_id(), composite
-- tenant-scoped foreign keys, ENABLE + FORCE RLS, one contractor_app
-- policy, grants to contractor_app.

-- ── Buildings ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  customer_id uuid NOT NULL,

  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
  address text NOT NULL DEFAULT '' CHECK (char_length(address) <= 200),
  city text NOT NULL DEFAULT '' CHECK (char_length(city) <= 100),
  state text NOT NULL DEFAULT '' CHECK (char_length(state) <= 100),
  postal_code text NOT NULL DEFAULT '' CHECK (char_length(postal_code) <= 20),
  primary_contact text NOT NULL DEFAULT '' CHECK (char_length(primary_contact) <= 200),
  contact_phone text NOT NULL DEFAULT '' CHECK (char_length(contact_phone) <= 40),
  contact_email text NOT NULL DEFAULT '' CHECK (char_length(contact_email) <= 320),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT
);

-- migrate:split

CREATE INDEX IF NOT EXISTS buildings_org_customer_idx
  ON buildings (organization_id, customer_id, created_at DESC);

-- migrate:split

-- ── Elevator units ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS elevator_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  building_id uuid NOT NULL,

  unit_number text NOT NULL CHECK (char_length(unit_number) BETWEEN 1 AND 60),
  elevator_number text NOT NULL DEFAULT '' CHECK (char_length(elevator_number) <= 60),
  manufacturer text NOT NULL DEFAULT '' CHECK (char_length(manufacturer) <= 120),
  model text NOT NULL DEFAULT '' CHECK (char_length(model) <= 120),
  serial_number text NOT NULL DEFAULT '' CHECK (char_length(serial_number) <= 120),
  elevator_type text NOT NULL DEFAULT ''
    CHECK (elevator_type IN ('', 'traction', 'hydraulic', 'machine_room_less', 'other')),
  rated_load_lbs integer CHECK (rated_load_lbs IS NULL OR rated_load_lbs > 0),
  rated_speed_fpm integer CHECK (rated_speed_fpm IS NULL OR rated_speed_fpm > 0),
  stops integer CHECK (stops IS NULL OR stops > 0),
  floors_served text NOT NULL DEFAULT '' CHECK (char_length(floors_served) <= 200),
  controller_manufacturer text NOT NULL DEFAULT '' CHECK (char_length(controller_manufacturer) <= 120),
  controller_model text NOT NULL DEFAULT '' CHECK (char_length(controller_model) <= 120),
  drive_manufacturer text NOT NULL DEFAULT '' CHECK (char_length(drive_manufacturer) <= 120),
  drive_model text NOT NULL DEFAULT '' CHECK (char_length(drive_model) <= 120),
  door_operator_manufacturer text NOT NULL DEFAULT '' CHECK (char_length(door_operator_manufacturer) <= 120),
  door_operator_model text NOT NULL DEFAULT '' CHECK (char_length(door_operator_model) <= 120),
  existing_condition text NOT NULL DEFAULT '' CHECK (char_length(existing_condition) <= 4000),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  UNIQUE (organization_id, building_id, unit_number),
  FOREIGN KEY (building_id, organization_id)
    REFERENCES buildings (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS elevator_units_org_building_idx
  ON elevator_units (organization_id, building_id, unit_number);

-- migrate:split

-- ── Modernization projects ──────────────────────────────────────────
--
-- The project is the Ascend operational center. Money in Phase 1 is a
-- single non-negative integer-cent contract value; budget / actual /
-- committed / forecast / progress / billing arrive in Phases 3-6.

CREATE TABLE IF NOT EXISTS modernization_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  display_id text NOT NULL CHECK (display_id ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),

  customer_id uuid NOT NULL,
  building_id uuid,

  status text NOT NULL DEFAULT 'prospect'
    CHECK (status IN ('prospect', 'bidding', 'awarded', 'in_progress',
                      'substantially_complete', 'closed', 'cancelled')),
  contract_value_cents bigint NOT NULL DEFAULT 0 CHECK (contract_value_cents >= 0),
  project_manager text NOT NULL DEFAULT '' CHECK (char_length(project_manager) <= 200),
  start_date date,
  target_completion_date date,
  actual_completion_date date,
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, display_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (building_id, organization_id)
    REFERENCES buildings (id, organization_id) ON DELETE SET NULL,
  CHECK (target_completion_date IS NULL OR start_date IS NULL
         OR target_completion_date >= start_date)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS modernization_projects_org_customer_idx
  ON modernization_projects (organization_id, customer_id, created_at DESC);

-- migrate:split

CREATE INDEX IF NOT EXISTS modernization_projects_org_status_idx
  ON modernization_projects (organization_id, status, updated_at DESC);

-- migrate:split

-- ── Project ↔ elevator links ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_elevators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  project_id uuid NOT NULL,
  elevator_unit_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (project_id, elevator_unit_id),
  FOREIGN KEY (project_id, organization_id)
    REFERENCES modernization_projects (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (elevator_unit_id, organization_id)
    REFERENCES elevator_units (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS project_elevators_project_idx
  ON project_elevators (project_id, elevator_unit_id);

-- migrate:split

CREATE INDEX IF NOT EXISTS project_elevators_unit_idx
  ON project_elevators (elevator_unit_id, project_id);

-- migrate:split

-- ── Row-level security ──────────────────────────────────────────────

ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE buildings FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE elevator_units ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE elevator_units FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE modernization_projects ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE modernization_projects FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE project_elevators ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE project_elevators FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY buildings_tenant_isolation ON buildings
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY elevator_units_tenant_isolation ON elevator_units
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY modernization_projects_tenant_isolation ON modernization_projects
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY project_elevators_tenant_isolation ON project_elevators
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON buildings, elevator_units, modernization_projects, project_elevators
  TO contractor_app;
