-- regressions.sql
--
-- Regression tests for defects found by running the suites against a freshly
-- migrated branch (see migrations 032-033):
--
--   1. The application's invoice statements (issue / record payment / cancel)
--      set only `status` and rely on the trigger to stamp lifecycle timestamps.
--      Under migration 017 every one of them failed a CHECK constraint.
--   2. Dispatch tickets are tenant-bound: another tenant cannot read them, the
--      public lookup requires the tracking-token hash and returns no contact
--      details, and platform_runtime has no direct access.
--
-- Runs as the owner inside one transaction that ROLLs BACK.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE control_app;
INSERT INTO organizations (id, slug, display_name, status) VALUES
  ('c0c0c0c0-0000-0000-0000-00000000000a', 'regress-alpha', 'Regress Alpha', 'active'),
  ('c0c0c0c0-0000-0000-0000-00000000000b', 'regress-beta',  'Regress Beta',  'active');
RESET ROLE;

-- --------------------------------------------------------------------------
-- 1. Invoice lifecycle through the application's statement shapes
-- --------------------------------------------------------------------------
DO $$
DECLARE
  customer uuid;
  issued_invoice uuid;
  draft_invoice uuid;
  row_status text;
  stamped timestamptz;
  raised boolean;
BEGIN
  PERFORM set_application_context('c0c0c0c0-0000-0000-0000-00000000000a'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  INSERT INTO customers (organization_id, document_number, display_id, display_name)
  VALUES (app_require_organization_id(), allocate_document_number('customer'), 'RA-CUS-0001', 'Regress Customer')
  RETURNING id INTO customer;

  INSERT INTO invoices (document_number, display_id, customer_id, title, subtotal_cents, taxable_subtotal_cents, total_cents)
  VALUES (allocate_document_number('invoice'), 'RA-INV-0001', customer, 'Service', 10000, 0, 10000)
  RETURNING id INTO issued_invoice;

  -- issueInvoice(): SET status = 'issued' only.
  UPDATE invoices SET status = 'issued', updated_at = now() WHERE id = issued_invoice;
  SELECT issued_at INTO stamped FROM invoices WHERE id = issued_invoice;
  IF stamped IS NULL THEN
    RAISE EXCEPTION 'Issuing an invoice did not stamp issued_at.';
  END IF;

  -- recordPayment(): partial, then the balance.
  UPDATE invoices
     SET amount_paid_cents = amount_paid_cents + 4000,
         status = CASE WHEN amount_paid_cents + 4000 >= total_cents THEN 'paid' ELSE 'partially_paid' END
   WHERE id = issued_invoice;
  SELECT status INTO row_status FROM invoices WHERE id = issued_invoice;
  IF row_status <> 'partially_paid' THEN
    RAISE EXCEPTION 'A partial payment left the invoice %.', row_status;
  END IF;

  raised := false;
  BEGIN
    UPDATE invoices SET title = 'Edited while partially paid' WHERE id = issued_invoice;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A partially paid invoice was edited.';
  END IF;

  UPDATE invoices
     SET amount_paid_cents = amount_paid_cents + 6000,
         status = CASE WHEN amount_paid_cents + 6000 >= total_cents THEN 'paid' ELSE 'partially_paid' END
   WHERE id = issued_invoice;
  SELECT status, paid_at INTO row_status, stamped FROM invoices WHERE id = issued_invoice;
  IF row_status <> 'paid' OR stamped IS NULL THEN
    RAISE EXCEPTION 'Settling the balance left the invoice % (paid_at %).', row_status, stamped;
  END IF;

  -- cancelInvoice() on a draft: SET status = 'cancelled' only.
  INSERT INTO invoices (document_number, display_id, customer_id, title)
  VALUES (allocate_document_number('invoice'), 'RA-INV-0002', customer, 'Draft to cancel')
  RETURNING id INTO draft_invoice;
  UPDATE invoices SET status = 'cancelled' WHERE id = draft_invoice;
  SELECT cancelled_at INTO stamped FROM invoices WHERE id = draft_invoice;
  IF stamped IS NULL THEN
    RAISE EXCEPTION 'Cancelling an invoice did not stamp cancelled_at.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Dispatch tickets are tenant-bound and token-tracked
-- --------------------------------------------------------------------------
DO $$
DECLARE
  token_hash text := encode(sha256('regress-tracking-token'::bytea), 'hex');
  created_id uuid;
  seen int;
  result jsonb;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('c0c0c0c0-0000-0000-0000-00000000000a'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT id INTO created_id FROM create_dispatch_ticket(
    token_hash, 'electrical', 'Panel buzzing', '1 Main St',
    'Pat Doe', 'pat@example.test', '555-0100', 'urgent', NULL);
  IF (SELECT organization_id FROM dispatch_tickets WHERE id = created_id)
     <> 'c0c0c0c0-0000-0000-0000-00000000000a'::uuid THEN
    RAISE EXCEPTION 'A dispatch ticket was not bound to the receiving tenant.';
  END IF;

  result := lookup_dispatch_ticket(token_hash);
  IF NOT (result->>'ok')::boolean THEN
    RAISE EXCEPTION 'The owning tenant could not look up its ticket by token.';
  END IF;
  IF result ? 'contactName' OR result ? 'contactPhone' OR result ? 'contactEmail' THEN
    RAISE EXCEPTION 'The public dispatch lookup returned contact details.';
  END IF;

  IF (lookup_dispatch_ticket(encode(sha256('wrong-token'::bytea), 'hex'))->>'ok')::boolean THEN
    RAISE EXCEPTION 'A dispatch lookup succeeded with the wrong token.';
  END IF;
  RESET ROLE;

  PERFORM set_application_context('c0c0c0c0-0000-0000-0000-00000000000b'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT count(*) INTO seen FROM dispatch_tickets;
  IF seen <> 0 THEN
    RAISE EXCEPTION 'Tenant beta read tenant alpha''s dispatch tickets.';
  END IF;
  IF (lookup_dispatch_ticket(token_hash)->>'ok')::boolean THEN
    RAISE EXCEPTION 'Tenant beta resolved tenant alpha''s tracking token.';
  END IF;
  RESET ROLE;

  SET LOCAL ROLE platform_runtime;
  BEGIN
    PERFORM count(*) FROM dispatch_tickets;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  RESET ROLE;
  IF NOT raised THEN
    RAISE EXCEPTION 'platform_runtime can still read dispatch tickets directly.';
  END IF;
END;
$$;

ROLLBACK;

\echo 'regressions.sql: all checks passed'
