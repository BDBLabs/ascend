-- seed-ascend-demo.sql
--
-- Ascend demo-organization seed: one elevator-modernization company with a
-- small but complete dataset exercising every Ascend view (dashboard,
-- projects, buildings, elevators, progress, costs, parts, billing).
--
-- Organization:  b7ea0f0e-373e-4a89-8684-aaf1c14d26f3
--   slug         ascend-demo / "Ascend Demo Co." (active)
-- Customer:      Meridian Property Group (CUS-0001)
-- Building:      Meridian Tower, Long Island City NY
-- Units:         CAR-1 (traction), CAR-2 (hydraulic)
-- Project:       ASC-0001 (awarded, $1,250,000, both units)
-- Packages:      Engineering (complete), Controller (in_progress 40%),
--                Installation + Testing (not_started)
-- Costs:         material + labor actuals, subcontract committed,
--                budget + forecast lines
-- Parts:         controller (ordered, PO-101), wire rope (specified)
-- Billing:       10% retainage schedule, October 2026 period 1
--
-- Staff login is NOT created here: provision it through the operator
-- endpoint (POST /api/auth/register with FIELD_PROVISION_SECRET),
-- which hashes the password and writes the membership correctly.
--
-- Safe to re-run: every insert is guarded (ON CONFLICT / NOT EXISTS).
-- Demo data on a shared branch only — never point this at a real
-- production tenant database.

BEGIN;

-- ---------------------------------------------------------------------------
-- Control plane: the organization
-- ---------------------------------------------------------------------------
SET LOCAL ROLE control_app;

INSERT INTO organizations (id, slug, display_name, status)
VALUES ('b7ea0f0e-373e-4a89-8684-aaf1c14d26f3', 'ascend-demo', 'Ascend Demo Co.', 'active')
ON CONFLICT (slug) DO NOTHING;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Tenant plane: as contractor_app under the org context, the path the
-- Field API uses. The customer counter fixes next allocation at #2 so a
-- later app-created customer cannot collide with CUS-0001.
-- ---------------------------------------------------------------------------
SELECT set_application_context('b7ea0f0e-373e-4a89-8684-aaf1c14d26f3'::uuid, NULL, gen_random_uuid());
SET LOCAL ROLE contractor_app;

INSERT INTO organization_record_counters (organization_id, record_kind, next_value)
VALUES ('b7ea0f0e-373e-4a89-8684-aaf1c14d26f3', 'customer', 2)
ON CONFLICT (organization_id, record_kind) DO NOTHING;

INSERT INTO customers
  (id, organization_id, document_number, display_id, display_name,
   contact_name, email, phone, service_address, town, postal_code, notes)
VALUES (
  '8c940abe-0708-43c4-a5cd-b8292b1d2574',
  'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
  1, 'CUS-0001', 'Meridian Property Group',
  'Dana Reyes', 'dana@meridian.example', '555-0142',
  '1 Court Square', 'Long Island City', '11101', 'Demo account'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO buildings
  (id, organization_id, customer_id, name, address, city, state, postal_code,
   primary_contact, contact_phone, contact_email, notes)
VALUES (
  'cc0a0c7c-beb3-4bdb-95cd-10e46f129b93',
  'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
  '8c940abe-0708-43c4-a5cd-b8292b1d2574',
  'Meridian Tower', '1 Court Square', 'Long Island City', 'NY', '11101',
  'Dana Reyes', '555-0142', 'dana@meridian.example', 'Demo site'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO elevator_units
  (id, organization_id, building_id, unit_number, elevator_number,
   manufacturer, model, elevator_type, rated_load_lbs, rated_speed_fpm,
   stops, floors_served, controller_manufacturer, controller_model,
   existing_condition, notes)
VALUES
  ('f37e3d55-b52b-4a4e-9c21-61a87809f8d6',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   'cc0a0c7c-beb3-4bdb-95cd-10e46f129b93',
   'CAR-1', 'E-01', 'Otis', 'Gen2', 'traction', 3500, 500, 12, '1-12',
   'Otis', 'OCSS', 'Worn ropes, original 1998 controller', 'Demo unit'),
  ('3400e63c-e9fd-47f7-9889-aa62ee47f42d',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   'cc0a0c7c-beb3-4bdb-95cd-10e46f129b93',
   'CAR-2', 'E-02', 'Schindler', '330A', 'hydraulic', 2500, 150, 5, '1-5',
   'Schindler', 'BX', 'Leaking jack packing', 'Demo unit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO modernization_projects
  (id, organization_id, display_id, customer_id, building_id, status,
   contract_value_cents, project_manager, start_date, target_completion_date, notes)
VALUES (
  '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
  'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
  'ASC-0001', '8c940abe-0708-43c4-a5cd-b8292b1d2574',
  'cc0a0c7c-beb3-4bdb-95cd-10e46f129b93',
  'awarded', 125000000, 'Demo Manager', '2026-10-01', '2027-03-31',
  'Demo modernization project'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_elevators (organization_id, project_id, elevator_unit_id)
VALUES
  ('b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   'f37e3d55-b52b-4a4e-9c21-61a87809f8d6'),
  ('b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   '3400e63c-e9fd-47f7-9889-aa62ee47f42d')
ON CONFLICT (project_id, elevator_unit_id) DO NOTHING;

INSERT INTO work_packages
  (id, organization_id, project_id, name, category, description,
   budget_cost_cents, contract_value_cents,
   planned_start, planned_finish, status, percent_complete, responsible_person)
VALUES
  ('746b329c-0b7c-40de-bb04-25f62acef1d4',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   'Engineering', 'Engineering', 'Survey, drawings, submittals',
   12000000, 18000000, '2026-10-01', '2026-11-15',
   'complete', 100, 'Demo Manager'),
  ('7b762643-8c15-4200-970c-caca1b221137',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   'Controller', 'Controller', 'Replace controller and drives, both cars',
   20000000, 32000000, '2026-11-01', '2027-01-15',
   'in_progress', 40, 'Demo Manager'),
  ('b0b7e112-132a-4640-9217-6944ba997faa',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   'Installation', 'Installation', 'Set equipment, wire, adjust',
   35000000, 50000000, '2027-01-05', '2027-03-15',
   'not_started', 0, ''),
  ('c68c24ec-147d-4dbe-ae0c-825b221c0037',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   'Testing', 'Testing', 'Acceptance and safety testing',
   8000000, 12000000, '2027-03-16', '2027-03-31',
   'not_started', 0, '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO work_package_events
  (organization_id, work_package_id, event, actor_id, meta)
SELECT 'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3', w.id, 'created', NULL, '{}'::jsonb
FROM (VALUES
  ('746b329c-0b7c-40de-bb04-25f62acef1d4'::uuid),
  ('7b762643-8c15-4200-970c-caca1b221137'::uuid),
  ('b0b7e112-132a-4640-9217-6944ba997faa'::uuid),
  ('c68c24ec-147d-4dbe-ae0c-825b221c0037'::uuid)
) AS w(id)
WHERE NOT EXISTS (
  SELECT 1 FROM work_package_events e
  WHERE e.work_package_id = w.id AND e.event = 'created'
);

INSERT INTO project_cost_entries
  (id, organization_id, project_id, work_package_id,
   cost_kind, cost_category, amount_cents,
   labor_hours_hundredths, labor_rate_cents_per_hour,
   cost_date, source_type, source_ref, description)
VALUES
  ('62b5e579-4bd9-49a5-943a-e0e2dac40c4c',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   '746b329c-0b7c-40de-bb04-25f62acef1d4',
   'budget', 'engineering', 12000000, NULL, NULL,
   '2026-10-01', 'estimate', 'EST-DEMO', 'Engineering budget'),
  ('6e3d75c4-b0cc-4b7d-97b6-5b02fea6bd8b',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   '7b762643-8c15-4200-970c-caca1b221137',
   'budget', 'material', 20000000, NULL, NULL,
   '2026-10-01', 'estimate', 'EST-DEMO', 'Controller budget'),
  ('b98e1839-0fbb-40fd-a8d5-34ecbc34c12e',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   '7b762643-8c15-4200-970c-caca1b221137',
   'actual', 'material', 4500000, NULL, NULL,
   '2026-10-20', 'invoice', 'INV-DEMO-1', 'Controller deposit'),
  ('4c15a05c-ffcf-45e9-ad6e-96c6e633e37c',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   '746b329c-0b7c-40de-bb04-25f62acef1d4',
   'actual', 'labor', 760000, 8000, 9500,
   '2026-10-25', 'timesheet', 'TS-DEMO-1', 'Survey labor 80h'),
  ('b0c8e73f-4403-4b65-ba8e-e0156f2c24cd',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   'b0b7e112-132a-4640-9217-6944ba997faa',
   'committed', 'subcontract', 12000000, NULL, NULL,
   '2026-10-28', 'purchase-order', 'PO-DEMO-2', 'Hoistway work subcontract'),
  ('d11f87f4-a82c-433d-a73b-fd9b586a2d2b',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b', NULL,
   'forecast', 'other', 98000000, NULL, NULL,
   '2026-10-31', 'forecast', 'FCST-DEMO-1', 'Forecast final cost')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_parts
  (id, organization_id, project_id, elevator_unit_id, work_package_id,
   description, quantity_required_hundredths, quantity_received_hundredths,
   status, planned_cost_cents, actual_cost_cents,
   supplier, source_ref, needed_date, notes)
VALUES
  ('2d8ce971-a9a6-4fc3-97c5-65b6bd4b13b8',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   'f37e3d55-b52b-4a4e-9c21-61a87809f8d6',
   '7b762643-8c15-4200-970c-caca1b221137',
   'GAL controller, 12 stops', 100, 100,
   'ordered', 6800000, 4500000,
   'GAL', 'PO-101', '2026-11-15', 'Demo part'),
  ('c57ed630-0e8c-435c-9872-3a9accc35e47',
   'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
   '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
   'f37e3d55-b52b-4a4e-9c21-61a87809f8d6', NULL,
   'Wire rope set, CAR-1', 200, 0,
   'specified', 320000, 0,
   '', '', '2026-12-01', 'Demo part')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_part_events
  (organization_id, project_part_id, event, actor_id, meta)
SELECT 'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3', p.id, 'created', NULL, '{}'::jsonb
FROM (VALUES
  ('2d8ce971-a9a6-4fc3-97c5-65b6bd4b13b8'::uuid),
  ('c57ed630-0e8c-435c-9872-3a9accc35e47'::uuid)
) AS p(id)
WHERE NOT EXISTS (
  SELECT 1 FROM project_part_events e
  WHERE e.project_part_id = p.id AND e.event = 'created'
);

INSERT INTO billing_schedules (id, organization_id, project_id, retainage_percent, notes)
VALUES (
  '37195ee3-f7c3-4939-8a0a-9d23e8323abf',
  'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
  '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
  10, 'Demo schedule'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO billing_periods
  (id, organization_id, project_id, period_number, period_start, period_end, status)
VALUES (
  'f4646958-b958-4fe2-a16c-52f3ae8ed964',
  'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3',
  '651b3325-dff6-4f04-b315-27bb2cc3ef6b',
  1, '2026-10-01', '2026-10-31', 'open'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
