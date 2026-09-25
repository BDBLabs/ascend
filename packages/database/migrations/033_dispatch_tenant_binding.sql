-- 033_dispatch_tenant_binding.sql
--
-- The public dispatch portal (021/023) was the one table outside the tenant
-- boundary:
--   - dispatch_tickets.organization_id was nullable and never set, so every
--     ticket was unattributed (isolation.sql: "organization_id is nullable");
--   - platform_runtime held a USING (true) policy plus full DML on it, i.e. a
--     platform-wide read/write path over customer contact details;
--   - the public tracker looked tickets up by a 6-digit number and returned the
--     submitter's name and phone, so the whole table was enumerable;
--   - dispatch_ticket_photos had no RLS and no tenant column.
--
-- After this migration a ticket belongs to the tenant whose verified hostname
-- received it, is written only through the tenant (contractor_app) path, and
-- can be read publicly only by presenting the 256-bit tracking token issued at
-- creation (stored as a SHA-256 hash, like customer_access_grants).
--
-- Rows created before this migration have no tenant. They are moved to
-- tables in the owner-only `quarantine` schema rather than deleted, so an operator can decide
-- their fate; no application role can read them.

CREATE SCHEMA IF NOT EXISTS quarantine;

-- migrate:split

REVOKE ALL ON SCHEMA quarantine FROM PUBLIC;

-- migrate:split

CREATE TABLE IF NOT EXISTS quarantine.dispatch_tickets
  (LIKE public.dispatch_tickets INCLUDING DEFAULTS);

-- migrate:split

CREATE TABLE IF NOT EXISTS quarantine.dispatch_ticket_photos
  (LIKE public.dispatch_ticket_photos INCLUDING DEFAULTS);

-- migrate:split

INSERT INTO quarantine.dispatch_ticket_photos
SELECT photo.*
FROM public.dispatch_ticket_photos AS photo
JOIN public.dispatch_tickets AS ticket ON ticket.id = photo.ticket_id
WHERE ticket.organization_id IS NULL;

-- migrate:split

INSERT INTO quarantine.dispatch_tickets
SELECT * FROM public.dispatch_tickets WHERE organization_id IS NULL;

-- migrate:split

DELETE FROM public.dispatch_tickets WHERE organization_id IS NULL;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Tenant binding
-- ---------------------------------------------------------------------------

ALTER TABLE dispatch_tickets
  DROP CONSTRAINT IF EXISTS dispatch_tickets_organization_id_fkey;

-- migrate:split

ALTER TABLE dispatch_tickets
  ALTER COLUMN organization_id SET NOT NULL;

-- migrate:split

ALTER TABLE dispatch_tickets
  ADD CONSTRAINT dispatch_tickets_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT;

-- migrate:split

ALTER TABLE dispatch_tickets
  ADD CONSTRAINT dispatch_tickets_id_organization_id_key UNIQUE (id, organization_id);

-- migrate:split

-- Ticket numbers are human-facing and now unique per tenant, not globally:
-- the global constraint leaked the existence of other tenants' tickets.
ALTER TABLE dispatch_tickets
  DROP CONSTRAINT IF EXISTS dispatch_tickets_ticket_number_key;

-- migrate:split

ALTER TABLE dispatch_tickets
  ADD CONSTRAINT dispatch_tickets_org_ticket_number_key UNIQUE (organization_id, ticket_number);

-- migrate:split

ALTER TABLE dispatch_tickets
  ADD COLUMN IF NOT EXISTS tracking_token_hash text
    CHECK (tracking_token_hash IS NULL OR tracking_token_hash ~ '^[a-f0-9]{64}$');

-- migrate:split

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_tickets_tracking_token_hash_key
  ON dispatch_tickets (tracking_token_hash)
  WHERE tracking_token_hash IS NOT NULL;

-- migrate:split

DROP POLICY IF EXISTS dispatch_tickets_platform_all ON dispatch_tickets;

-- migrate:split

REVOKE ALL ON dispatch_tickets FROM platform_runtime;

-- migrate:split

-- Photos: tenant column, RLS, composite FK so a photo can only attach to a
-- ticket of the same tenant.
ALTER TABLE dispatch_ticket_photos
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- migrate:split

UPDATE dispatch_ticket_photos AS photo
SET organization_id = ticket.organization_id
FROM dispatch_tickets AS ticket
WHERE ticket.id = photo.ticket_id AND photo.organization_id IS NULL;

-- migrate:split

ALTER TABLE dispatch_ticket_photos
  ALTER COLUMN organization_id SET NOT NULL;

-- migrate:split

ALTER TABLE dispatch_ticket_photos
  DROP CONSTRAINT IF EXISTS dispatch_ticket_photos_ticket_id_fkey;

-- migrate:split

ALTER TABLE dispatch_ticket_photos
  ADD CONSTRAINT dispatch_ticket_photos_ticket_fkey
    FOREIGN KEY (ticket_id, organization_id)
    REFERENCES dispatch_tickets (id, organization_id) ON DELETE CASCADE;

-- migrate:split

ALTER TABLE dispatch_ticket_photos
  ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 0
    CHECK (size_bytes BETWEEN 0 AND 8388608);

-- migrate:split

ALTER TABLE dispatch_ticket_photos ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE dispatch_ticket_photos FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY dispatch_ticket_photos_tenant_isolation ON dispatch_ticket_photos
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

REVOKE ALL ON dispatch_ticket_photos FROM PUBLIC, platform_runtime, control_app;

-- migrate:split

GRANT SELECT, INSERT, DELETE ON dispatch_ticket_photos TO contractor_app;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Functions: tenant path only. Old overloads are dropped so no untenanted
-- create/lookup path remains.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_dispatch_ticket(text, text, text);

-- migrate:split

DROP FUNCTION IF EXISTS create_dispatch_ticket(text, text, text, text, text, text, text, timestamptz);

-- migrate:split

DROP FUNCTION IF EXISTS lookup_dispatch_ticket(text);

-- migrate:split

-- SECURITY INVOKER: runs as contractor_app under the request's tenant context,
-- so RLS (not the function) is what binds the ticket to the tenant.
CREATE FUNCTION create_dispatch_ticket(
  p_tracking_token_hash text,
  p_category text,
  p_work_required text,
  p_site_location text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_priority text,
  p_preferred_date timestamptz
) RETURNS TABLE (id uuid, ticket_number text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket_number text;
  v_id uuid;
  v_attempts int := 0;
BEGIN
  IF p_tracking_token_hash IS NULL OR p_tracking_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'A tracking token hash is required.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  LOOP
    v_ticket_number := 'DRQ-' || lpad(floor(random() * 1000000)::int::text, 6, '0');
    v_attempts := v_attempts + 1;
    BEGIN
      INSERT INTO dispatch_tickets (
        organization_id, ticket_number, tracking_token_hash, category,
        work_required, site_location, contact_name, contact_email,
        contact_phone, priority, preferred_date
      ) VALUES (
        app_require_organization_id(), v_ticket_number, p_tracking_token_hash,
        p_category, p_work_required, coalesce(p_site_location, ''),
        coalesce(p_contact_name, ''), coalesce(p_contact_email, ''),
        coalesce(p_contact_phone, ''), coalesce(p_priority, 'normal'),
        p_preferred_date
      )
      RETURNING dispatch_tickets.id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 10 THEN
        RAISE EXCEPTION 'Failed to generate a unique ticket number after % attempts.', v_attempts;
      END IF;
    END;
  END LOOP;

  id := v_id;
  ticket_number := v_ticket_number;
  RETURN NEXT;
END;
$$;

-- migrate:split

-- Public status lookup. SECURITY INVOKER under the tenant context, keyed by
-- the token hash. Returns no contact details: possession of a tracking link
-- shows progress, not the submitter's personal data.
CREATE FUNCTION lookup_dispatch_ticket(p_tracking_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row dispatch_tickets%ROWTYPE;
BEGIN
  IF p_tracking_token_hash IS NULL OR p_tracking_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ticket not found.');
  END IF;

  SELECT * INTO v_row
  FROM dispatch_tickets
  WHERE tracking_token_hash = p_tracking_token_hash
    AND organization_id = app_require_organization_id();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ticket not found.');
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'ticketNumber', v_row.ticket_number,
    'status',       v_row.status,
    'activeStep',   v_row.active_step,
    'category',     v_row.category,
    'priority',     v_row.priority,
    'workSummary',  left(v_row.work_required, 200),
    'createdAt',    v_row.created_at
  );
END;
$$;
