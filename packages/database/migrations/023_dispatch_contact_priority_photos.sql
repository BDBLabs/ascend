-- 023_dispatch_contact_priority_photos.sql
--
-- Enriches the dispatch ticket schema with customer contact info, priority
-- classification, scheduling preferences, and photo attachments. These columns
-- are nullable so existing tickets remain valid; new tickets capture them
-- at creation time.

-- ── New columns on dispatch_tickets ─────────────────────────────────

ALTER TABLE dispatch_tickets
  ADD COLUMN IF NOT EXISTS contact_name text
    DEFAULT '' CHECK (contact_name IS NULL OR char_length(contact_name) <= 200);

ALTER TABLE dispatch_tickets
  ADD COLUMN IF NOT EXISTS contact_email text
    DEFAULT '' CHECK (contact_email IS NULL OR char_length(contact_email) <= 320);

ALTER TABLE dispatch_tickets
  ADD COLUMN IF NOT EXISTS contact_phone text
    DEFAULT '' CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 40);

ALTER TABLE dispatch_tickets
  ADD COLUMN IF NOT EXISTS priority text
    NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('emergency', 'urgent', 'normal', 'low'));

ALTER TABLE dispatch_tickets
  ADD COLUMN IF NOT EXISTS preferred_date timestamptz;

-- ── Photo attachments ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dispatch_ticket_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL
    REFERENCES dispatch_tickets(id) ON DELETE CASCADE,
  storage_key text NOT NULL CHECK (char_length(storage_key) <= 500),
  filename text NOT NULL DEFAULT ''
    CHECK (char_length(filename) <= 200),
  mime_type text NOT NULL DEFAULT 'application/octet-stream'
    CHECK (char_length(mime_type) <= 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:split

CREATE INDEX IF NOT EXISTS dispatch_ticket_photos_ticket_idx
  ON dispatch_ticket_photos (ticket_id, created_at ASC);

-- ── Update create_dispatch_ticket to accept new fields ──────────────

CREATE OR REPLACE FUNCTION create_dispatch_ticket(
  p_category text,
  p_work_required text,
  p_site_location text,
  p_contact_name text DEFAULT '',
  p_contact_email text DEFAULT '',
  p_contact_phone text DEFAULT '',
  p_priority text DEFAULT 'normal',
  p_preferred_date timestamptz DEFAULT NULL
) RETURNS jsonb
    SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
  v_ticket_number text;
  v_id uuid;
  v_attempts int := 0;
BEGIN
  LOOP
    v_ticket_number := 'DRQ-' || lpad(floor(random() * 999999)::int::text, 6, '0');
    v_attempts := v_attempts + 1;
    BEGIN
      INSERT INTO dispatch_tickets (
        ticket_number, category, work_required, site_location,
        contact_name, contact_email, contact_phone,
        priority, preferred_date
      ) VALUES (
        v_ticket_number, p_category, p_work_required, p_site_location,
        p_contact_name, p_contact_email, p_contact_phone,
        p_priority, p_preferred_date
      )
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 10 THEN
        RAISE EXCEPTION 'Failed to generate unique ticket number after % attempts', v_attempts;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('id', v_id, 'ticket_number', v_ticket_number);
END;
$$ LANGUAGE plpgsql;

-- ── Update lookup_dispatch_ticket to return contact + priority ──────

CREATE OR REPLACE FUNCTION lookup_dispatch_ticket(p_ticket_number text)
RETURNS jsonb
    SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
  v_row dispatch_tickets%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM dispatch_tickets
    WHERE ticket_number = p_ticket_number;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ticket not found.');
  END IF;

  RETURN jsonb_build_object(
    'ok',          true,
    'ticketNumber', v_row.ticket_number,
    'status',      v_row.status,
    'activeStep',  v_row.active_step,
    'category',    v_row.category,
    'contactName', COALESCE(v_row.contact_name, ''),
    'contactPhone',COALESCE(v_row.contact_phone, ''),
    'priority',    v_row.priority,
    'workSummary', LEFT(v_row.work_required, 200),
    'createdAt',   v_row.created_at
  );
END;
$$ LANGUAGE plpgsql;
