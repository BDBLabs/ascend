-- Migration 019: Dispatch Tickets & Estimate Sketch Elements
-- Phase 4: Database & API Plumbing

-- ---------------------------------------------------------------------------
-- 1. Dispatch tickets (public-facing, no tenant context at creation time)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dispatch_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE
    CHECK (ticket_number ~ '^DRQ-[0-9]{6}$'),
  category text NOT NULL
    CHECK (category IN ('electrical', 'plumbing', 'hvac', 'general')),
  work_required text NOT NULL CHECK (char_length(work_required) BETWEEN 1 AND 4000),
  site_location text NOT NULL DEFAULT '' CHECK (char_length(site_location) <= 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewing', 'bid_sent', 'approved', 'in_progress', 'completed')),
  active_step integer NOT NULL DEFAULT 0
    CHECK (active_step BETWEEN 0 AND 4),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:split

CREATE INDEX IF NOT EXISTS idx_dispatch_tickets_number
  ON dispatch_tickets (ticket_number);

-- migrate:split

CREATE INDEX IF NOT EXISTS idx_dispatch_tickets_status
  ON dispatch_tickets (status, created_at DESC);

-- migrate:split

-- ---------------------------------------------------------------------------
-- 2. RLS for dispatch_tickets
-- ---------------------------------------------------------------------------

ALTER TABLE dispatch_tickets ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE dispatch_tickets FORCE ROW LEVEL SECURITY;

-- migrate:split

-- contractor_app can read/write dispatch_tickets for their org
CREATE POLICY dispatch_tickets_tenant_isolation ON dispatch_tickets
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

-- platform_runtime can read/write all dispatch_tickets (public portal)
CREATE POLICY dispatch_tickets_platform_all ON dispatch_tickets
  FOR ALL TO platform_runtime
  USING (true)
  WITH CHECK (true);

-- migrate:split

-- ---------------------------------------------------------------------------
-- 3. Grants for dispatch_tickets
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE
  ON dispatch_tickets
  TO contractor_app;

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON dispatch_tickets
  TO platform_runtime;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 4. SECURITY DEFINER: create_dispatch_ticket (public portal, no auth)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_dispatch_ticket(
  p_category text,
  p_work_required text,
  p_site_location text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket_number text;
  v_id uuid;
BEGIN
  v_ticket_number := 'DRQ-' || lpad(floor(random() * 999999)::int::text, 6, '0');

  INSERT INTO dispatch_tickets (ticket_number, category, work_required, site_location)
  VALUES (v_ticket_number, p_category, p_work_required, p_site_location)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'ticket_number', v_ticket_number
  );
END;
$$;

-- migrate:split

GRANT EXECUTE
  ON FUNCTION create_dispatch_ticket(text, text, text)
  TO platform_runtime;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER: lookup_dispatch_ticket (public portal, no auth)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lookup_dispatch_ticket(
  p_ticket_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket dispatch_tickets%ROWTYPE;
BEGIN
  SELECT * INTO v_ticket
  FROM dispatch_tickets
  WHERE ticket_number = p_ticket_number;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ticket not found.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'ticketNumber', v_ticket.ticket_number,
    'status', v_ticket.status,
    'activeStep', v_ticket.active_step,
    'category', v_ticket.category,
    'createdAt', v_ticket.created_at
  );
END;
$$;

-- migrate:split

GRANT EXECUTE
  ON FUNCTION lookup_dispatch_ticket(text)
  TO platform_runtime;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 6. Estimate sketch elements (tenant-scoped, stored per estimate)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estimate_sketch_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  estimate_id uuid NOT NULL
    REFERENCES estimates(id) ON DELETE CASCADE,
  symbol_id text NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  x integer NOT NULL,
  y integer NOT NULL,
  unit_price_cents integer NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS idx_sketch_elements_estimate
  ON estimate_sketch_elements (estimate_id, position);

-- migrate:split

-- ---------------------------------------------------------------------------
-- 7. RLS for estimate_sketch_elements
-- ---------------------------------------------------------------------------

ALTER TABLE estimate_sketch_elements ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE estimate_sketch_elements FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY sketch_elements_tenant_isolation ON estimate_sketch_elements
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

-- ---------------------------------------------------------------------------
-- 8. Grants for estimate_sketch_elements
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE
  ON estimate_sketch_elements
  TO contractor_app;
