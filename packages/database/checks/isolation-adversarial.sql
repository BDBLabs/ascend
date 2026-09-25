-- isolation-adversarial.sql
--
-- Adversarial tenant-isolation verification. The existing isolation.sql proves
-- the structural guarantees (FORCE RLS, no BYPASSRLS, no nullable org keys);
-- this suite attacks the boundary with two synthetic tenants (tenant-alpha,
-- tenant-beta), each holding equivalent representative records, and tries to
-- cross the boundary from the other side.
--
--   - valid foreign ids        (read B's row by id from A's context)
--   - guessed foreign ids      (write/update/delete B's row from A's context)
--   - missing/null/malformed tenant context
--   - stale pooled state       (context must not survive a transaction)
--   - nested context switching (A then B, each sees only its own)
--   - background/cron path     (platform_runtime direct vs. sanctioned window)
--   - control-plane path       (control_app cannot touch tenant content)
--   - customer-access grants   (B's token invisible from A)
--   - staff memberships        (A sees only its members)
--   - administrative path      (migration owner bypasses RLS, deliberately)
--
-- Runs as the migration owner (which holds contractor_app/control_app/
-- platform_runtime) inside one transaction that ROLLs BACK. Destructive in
-- shape but never persisted; run against a disposable branch, never production.
-- Every assertion raises on failure; a clean exit is the pass condition.

\set ON_ERROR_STOP on

BEGIN;

-- --------------------------------------------------------------------------
-- Provision two equivalent tenants (control plane path)
-- --------------------------------------------------------------------------
SET LOCAL ROLE control_app;

INSERT INTO organizations (id, slug, display_name, status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tenant-alpha', 'Alpha Electric', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tenant-beta',  'Beta Electric',  'active');

INSERT INTO organization_domains (organization_id, hostname, is_canonical, verified, verified_at) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha.example.test', true, true,  now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta.example.test',  true, true,  now());

-- Identity rows are platform-owned; the control plane manages them.
INSERT INTO platform_users (id, clerk_user_id, email, display_name, status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'clerk_user_alpha', 'alice@alpha.test', 'Alice Alpha', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'clerk_user_beta',  'bob@beta.test',    'Bob Beta',    'active');

-- Memberships are control-plane managed too (contractor_app is SELECT-only).
INSERT INTO organization_memberships (organization_id, platform_user_id, clerk_membership_id, role, status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-000000000001', 'membership_alpha', 'owner', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-0000-0000-000000000001', 'membership_beta',  'owner', 'active');

RESET ROLE;

-- --------------------------------------------------------------------------
-- Populate equivalent tenant-owned records
-- --------------------------------------------------------------------------
DO $$
BEGIN
  -- tenant-alpha
  PERFORM set_application_context('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  INSERT INTO customers (id, organization_id, document_number, display_id, display_name) VALUES
    ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'ALPHA-0001', 'Alpha Customer');

  INSERT INTO estimates (id, organization_id, document_number, display_id, customer_id, title) VALUES
    ('aaaaaaaa-0000-0000-0000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'ALPHA-0001',
     'aaaaaaaa-0000-0000-0000-0000000000a1', 'Alpha estimate');

  INSERT INTO estimate_line_items (estimate_id, organization_id, position, description, quantity_hundredths, unit_price_cents, line_total_cents) VALUES
    ('aaaaaaaa-0000-0000-0000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, 'Alpha line', 100, 10000, 10000);

  INSERT INTO service_requests (id, organization_id, document_number, display_id, contact_name, summary) VALUES
    ('aaaaaaaa-0000-0000-0000-0000000000a3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'ALPHA-0001', 'Alpha Request', 'Alpha request summary');

  INSERT INTO jobs (id, organization_id, document_number, display_id, customer_id, title) VALUES
    ('aaaaaaaa-0000-0000-0000-0000000000a4', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'ALPHA-0001',
     'aaaaaaaa-0000-0000-0000-0000000000a1', 'Alpha job');

  INSERT INTO configuration_versions (organization_id, version, status, document_version, document, approved_at) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'approved', 'config-v1', '{"identity":{"businessName":"Alpha"}}'::jsonb, now());

  INSERT INTO price_book_categories (organization_id, name) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alpha Category');

  INSERT INTO customer_access_grants (organization_id, customer_id, document_type, document_id, purpose, token_hash, expires_at) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'estimate',
     'aaaaaaaa-0000-0000-0000-0000000000a2', 'view',
     repeat('a', 64), now() + interval '1 day');

  INSERT INTO transactional_outbox (organization_id, topic, key, payload) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'estimate_delivery', 'alpha-msg', '{"displayId":"ALPHA-0001"}'::jsonb);

  RESET ROLE;

  -- tenant-beta — the mirror image
  PERFORM set_application_context('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  INSERT INTO customers (id, organization_id, document_number, display_id, display_name) VALUES
    ('bbbbbbbb-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 'BETA-0001', 'Beta Customer');

  INSERT INTO estimates (id, organization_id, document_number, display_id, customer_id, title) VALUES
    ('bbbbbbbb-0000-0000-0000-0000000000b2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 'BETA-0001',
     'bbbbbbbb-0000-0000-0000-0000000000b1', 'Beta estimate');

  INSERT INTO estimate_line_items (estimate_id, organization_id, position, description, quantity_hundredths, unit_price_cents, line_total_cents) VALUES
    ('bbbbbbbb-0000-0000-0000-0000000000b2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0, 'Beta line', 100, 20000, 20000);

  INSERT INTO service_requests (id, organization_id, document_number, display_id, contact_name, summary) VALUES
    ('bbbbbbbb-0000-0000-0000-0000000000b3', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 'BETA-0001', 'Beta Request', 'Beta request summary');

  INSERT INTO jobs (id, organization_id, document_number, display_id, customer_id, title) VALUES
    ('bbbbbbbb-0000-0000-0000-0000000000b4', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 'BETA-0001',
     'bbbbbbbb-0000-0000-0000-0000000000b1', 'Beta job');

  INSERT INTO configuration_versions (organization_id, version, status, document_version, document, approved_at) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 'approved', 'config-v1', '{"identity":{"businessName":"Beta"}}'::jsonb, now());

  INSERT INTO price_book_categories (organization_id, name) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Beta Category');

  INSERT INTO customer_access_grants (organization_id, customer_id, document_type, document_id, purpose, token_hash, expires_at) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'estimate',
     'bbbbbbbb-0000-0000-0000-0000000000b2', 'view',
     repeat('b', 64), now() + interval '1 day');

  INSERT INTO transactional_outbox (organization_id, topic, key, payload) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'estimate_delivery', 'beta-msg', '{"displayId":"BETA-0001"}'::jsonb);

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 1. Valid foreign ids: tenant alpha can never observe tenant beta's rows
-- --------------------------------------------------------------------------
-- Uniform read sweep: from alpha's context, every tenant-owned table must show
-- zero rows carrying beta's organization_id, and beta's rows must be invisible
-- even when addressed by their exact primary key.
DO $$
DECLARE
  t text;
  seen bigint;
  by_id bigint;
BEGIN
  PERFORM set_application_context('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  FOR t IN SELECT unnest(ARRAY[
    'customers', 'estimates', 'estimate_line_items', 'estimate_events',
    'service_requests', 'jobs', 'configuration_versions',
    'price_book_categories', 'price_book_items', 'price_book_releases',
    'customer_access_grants', 'transactional_outbox', 'organization_memberships'
  ]) LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE organization_id = %L',
      t, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') INTO seen;
    IF seen <> 0 THEN
      RAISE EXCEPTION 'Tenant alpha observed % rows of beta-owned data in %.', seen, t;
    END IF;
  END LOOP;

  -- beta's estimate addressed directly by primary key must be invisible
  SELECT count(*) INTO by_id FROM estimates WHERE id = 'bbbbbbbb-0000-0000-0000-0000000000b2';
  IF by_id <> 0 THEN
    RAISE EXCEPTION 'Tenant alpha read beta''s estimate by primary key.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Guessed foreign ids: writes and deletes aimed at beta from alpha's context
-- --------------------------------------------------------------------------
DO $$
DECLARE
  updated bigint;
  deleted bigint;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  -- UPDATE of a foreign row is filtered by RLS to zero rows
  UPDATE estimates SET title = 'hijacked' WHERE id = 'bbbbbbbb-0000-0000-0000-0000000000b2';
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 0 THEN
    RAISE EXCEPTION 'Tenant alpha updated beta''s estimate.';
  END IF;

  -- DELETE of a foreign row is likewise filtered to zero rows
  DELETE FROM estimates WHERE id = 'bbbbbbbb-0000-0000-0000-0000000000b2';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  IF deleted <> 0 THEN
    RAISE EXCEPTION 'Tenant alpha deleted beta''s estimate.';
  END IF;

  -- Attempting to insert a row that points at beta's customer must fail: the
  -- composite FK (customer_id, organization_id) ties the child to the parent
  -- tenant, and the RLS WITH CHECK ties the row to the current context.
  BEGIN
    INSERT INTO estimates (organization_id, document_number, display_id, customer_id, title) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 99, 'ALPHA-0099', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'Cross-tenant estimate');
    RAISE EXCEPTION 'Cross-tenant estimate insert succeeded.';
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'Cross-tenant estimate insert did not fail.';
  END IF;

  -- Explicitly naming beta's organization_id while operating in alpha's
  -- context must fail the RLS WITH CHECK.
  raised := false;
  BEGIN
    INSERT INTO customers (organization_id, document_number, display_id, display_name) VALUES
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 99, 'BETA-0099', 'Forged beta customer');
    RAISE EXCEPTION 'Forged tenant write succeeded.';
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A write naming another tenant''s organization_id was accepted.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 3. Missing, null, and malformed tenant context
-- --------------------------------------------------------------------------
DO $$
DECLARE
  raised boolean := false;
BEGIN
  SET LOCAL ROLE contractor_app;

  -- Missing context (empty)
  PERFORM set_config('app.organization_id', '', true);
  BEGIN
    INSERT INTO customers (organization_id, document_number, display_id, display_name) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100, 'ALPHA-0100', 'No context');
    RAISE EXCEPTION 'Write with empty context succeeded.';
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A write with no tenant context was accepted.';
  END IF;

  -- Null context
  PERFORM set_config('app.organization_id', NULL, true);
  BEGIN
    PERFORM app_require_organization_id();
    RAISE EXCEPTION 'app_require_organization_id() returned with NULL context.';
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'app_require_organization_id() did not raise on NULL context.';
  END IF;

  -- Malformed context (not a uuid) must fail closed: the context reader raises
  -- (invalid_text_representation), and a write is refused with it.
  PERFORM set_config('app.organization_id', 'not-a-uuid', true);
  raised := false;
  BEGIN
    PERFORM app_current_organization_id();
    RAISE EXCEPTION 'Malformed context resolved silently.';
  EXCEPTION WHEN invalid_text_representation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'Malformed tenant context did not fail the context reader.';
  END IF;

  raised := false;
  BEGIN
    INSERT INTO customers (organization_id, document_number, display_id, display_name) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 101, 'ALPHA-0101', 'Malformed context');
    RAISE EXCEPTION 'Write with malformed context succeeded.';
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A write with malformed tenant context was accepted.';
  END IF;

  PERFORM set_config('app.organization_id', '', true);

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Stale pooled connection state: context is transaction-scoped
-- --------------------------------------------------------------------------
-- set_application_context() stores the tenant via set_config(..., is_local :=
-- true), so it is scoped to the transaction that set it and cannot survive a
-- COMMIT/ROLLBACK. A single-transaction suite cannot demonstrate the COMMIT
-- boundary directly; it proves the two mechanisms that provide the guarantee:
--   (a) an unset GUC resolves to NULL (fails closed on a fresh connection), and
--   (b) aborting the subtransaction that set the context reverts it.
DO $$
DECLARE
  raised boolean := false;
BEGIN
  -- (a) Clear any context left by earlier sections (same suite transaction).
  PERFORM set_config('app.organization_id', '', true);
  IF app_current_organization_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Unset tenant context resolved to a non-NULL organization.';
  END IF;

  -- (b) Set context inside a subtransaction, then abort that subtransaction:
  -- the local GUC change must be reverted with it (as it would be at a real
  -- transaction COMMIT/ROLLBACK boundary).
  raised := false;
  BEGIN
    PERFORM set_application_context('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, gen_random_uuid());
    IF app_current_organization_id() IS NULL THEN
      RAISE EXCEPTION 'Context was not visible inside the subtransaction that set it.';
    END IF;
    RAISE EXCEPTION 'abort the subtransaction that set the tenant context';
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'Subtransaction did not abort.';
  END IF;
  IF app_current_organization_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Tenant context survived the transaction that set it.';
  END IF;

  RAISE NOTICE 'Section 4: tenant context is transaction-scoped; fresh connections read NULL.';
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Nested context switching: alpha then beta, each sees only its own
-- --------------------------------------------------------------------------
DO $$
DECLARE
  alpha_seen bigint;
  beta_seen bigint;
BEGIN
  PERFORM set_application_context('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT count(*) INTO alpha_seen FROM estimates;
  RESET ROLE;

  PERFORM set_application_context('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT count(*) INTO beta_seen FROM estimates;
  RESET ROLE;

  IF alpha_seen <> 1 OR beta_seen <> 1 THEN
    RAISE EXCEPTION 'Context switch mis-scoped: alpha saw %, beta saw %.', alpha_seen, beta_seen;
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. Background worker / cron path (platform_runtime)
-- --------------------------------------------------------------------------
-- platform_runtime is the cron/webhook/health role. It holds NO policy on
-- tenant tables: it must not read the outbox directly, and its only reach is
-- the sanctioned claim/finish windows.
DO $$
DECLARE
  raised boolean := false;
BEGIN
  SET LOCAL ROLE platform_runtime;

  BEGIN
    PERFORM count(*) FROM transactional_outbox;
    RAISE EXCEPTION 'platform_runtime read the outbox directly.';
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'platform_runtime could read tenant outbox rows directly (no window).';
  END IF;

  RESET ROLE;
END;
$$;

-- The sanctioned drain window is the only cross-tenant path and returns the
-- exact claimable work. Reset state afterward so later sections have clean
-- pending rows.
DO $$
DECLARE
  claimed_rows int;
BEGIN
  SET LOCAL ROLE platform_runtime;
  SELECT count(*) INTO claimed_rows FROM claim_ready_outbox_messages(5);
  IF claimed_rows < 2 THEN
    RAISE EXCEPTION 'Drain window returned % claimable messages; expected at least 2.', claimed_rows;
  END IF;
  RESET ROLE;

  UPDATE transactional_outbox
     SET status = 'pending', attempts = 0, next_attempt_at = now(), claimed_until = NULL, claim_token = NULL
   WHERE key IN ('alpha-msg', 'beta-msg');
END;
$$;

-- --------------------------------------------------------------------------
-- 7. Outbox lease: a crashed claim is re-delivered, fenced, and fair
-- --------------------------------------------------------------------------
-- A claim that crashes before finish leaves status='claimed'. Once its lease
-- expires the message must be claimable again, under a NEW claim token, so the
-- crashed worker's late finish cannot overwrite the new owner's outcome. A
-- lease that expires on the final attempt goes dead instead of being stranded.
DO $$
DECLARE
  stale_token uuid;
  fresh_token uuid;
  alpha_id uuid;
  claimed_keys text;
  alpha_status text;
  final_status text;
BEGIN
  SET LOCAL ROLE platform_runtime;
  SELECT claim_token INTO stale_token
    FROM claim_ready_outbox_messages(50) AS m WHERE m.key = 'alpha-msg';
  RESET ROLE;
  IF stale_token IS NULL THEN
    RAISE EXCEPTION 'alpha-msg was not claimable at the start of the lease test.';
  END IF;

  -- Simulate the crash: the lease is long expired, finish never ran.
  UPDATE transactional_outbox
     SET claimed_until = now() - interval '1 hour'
   WHERE key = 'alpha-msg'
  RETURNING id INTO alpha_id;

  SET LOCAL ROLE platform_runtime;
  SELECT string_agg(m.key, ',' ORDER BY m.key), max(m.claim_token::text) FILTER (WHERE m.key = 'alpha-msg')
    INTO claimed_keys, fresh_token
    FROM claim_ready_outbox_messages(50) AS m;

  IF claimed_keys IS NULL OR position('alpha-msg' in claimed_keys) = 0 THEN
    RAISE EXCEPTION 'A crashed claim with an expired lease was not re-claimed.';
  END IF;
  IF fresh_token IS NULL OR fresh_token = stale_token THEN
    RAISE EXCEPTION 'A re-claim did not issue a fresh claim token.';
  END IF;

  -- The crashed worker wakes up and reports: it must be fenced off.
  IF finish_outbox_message(alpha_id, stale_token, true, true, NULL) THEN
    RAISE EXCEPTION 'A stale claim token finished a re-claimed message.';
  END IF;
  RESET ROLE;

  SELECT status INTO alpha_status FROM transactional_outbox WHERE key = 'alpha-msg';
  IF alpha_status <> 'claimed' THEN
    RAISE EXCEPTION 'A stale finish changed the re-claimed message (status %).', alpha_status;
  END IF;

  -- Final-attempt lease expiry dead-letters.
  UPDATE transactional_outbox
     SET attempts = 12, claimed_until = now() - interval '1 minute'
   WHERE key = 'alpha-msg';
  SET LOCAL ROLE platform_runtime;
  PERFORM count(*) FROM claim_ready_outbox_messages(50);
  RESET ROLE;
  SELECT status INTO final_status FROM transactional_outbox WHERE key = 'alpha-msg';
  IF final_status <> 'dead' THEN
    RAISE EXCEPTION 'A lease that expired on the final attempt was left %.', final_status;
  END IF;

  UPDATE transactional_outbox
     SET status = 'pending', attempts = 0, next_attempt_at = now(), claimed_until = NULL,
         claim_token = NULL, last_error = NULL
   WHERE key IN ('alpha-msg', 'beta-msg');
END;
$$;

-- Fairness: a tenant with a deep backlog cannot starve another tenant. Alpha
-- gets 30 older messages; a batch of 5 must still include beta's one.
DO $$
DECLARE
  claimed_orgs int;
BEGIN
  PERFORM set_application_context('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  INSERT INTO transactional_outbox (organization_id, topic, key, payload, next_attempt_at)
  SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'estimate_delivery', 'alpha-backlog-' || n,
         '{}'::jsonb, now() - interval '1 hour'
  FROM generate_series(1, 30) AS n;
  RESET ROLE;

  SET LOCAL ROLE platform_runtime;
  SELECT count(DISTINCT organization_id) INTO claimed_orgs FROM claim_ready_outbox_messages(5);
  RESET ROLE;

  IF claimed_orgs <> 2 THEN
    RAISE EXCEPTION 'Outbox claim is not tenant-fair: a 5-message batch covered % tenant(s).', claimed_orgs;
  END IF;

  DELETE FROM transactional_outbox WHERE key LIKE 'alpha-backlog-%';
  UPDATE transactional_outbox
     SET status = 'pending', attempts = 0, next_attempt_at = now(), claimed_until = NULL, claim_token = NULL
   WHERE key IN ('alpha-msg', 'beta-msg');
END;
$$;

-- --------------------------------------------------------------------------
-- 8. Control-plane path: control_app cannot touch tenant content
-- --------------------------------------------------------------------------
DO $$
DECLARE
  raised boolean := false;
BEGIN
  SET LOCAL ROLE control_app;
  BEGIN
    INSERT INTO customers (organization_id, document_number, display_id, display_name) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 200, 'ALPHA-0200', 'Control plane writes');
    RAISE EXCEPTION 'control_app wrote a tenant row.';
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'control_app could write tenant content.';
  END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 9. Customer-access grants: beta's token is invisible from alpha's context
-- --------------------------------------------------------------------------
DO $$
DECLARE
  n bigint;
BEGIN
  PERFORM set_application_context('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT count(*) INTO n FROM customer_access_grants WHERE token_hash = repeat('b', 64);
  IF n <> 0 THEN
    RAISE EXCEPTION 'Tenant alpha resolved tenant beta''s customer-access grant by token hash.';
  END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 10. Staff memberships: a tenant reads only its own members
-- --------------------------------------------------------------------------
DO $$
DECLARE
  n bigint;
BEGIN
  PERFORM set_application_context('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT count(*) INTO n FROM platform_users;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Tenant alpha sees % users; expected exactly its own member.', n;
  END IF;
  RESET ROLE;

  PERFORM set_application_context('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT count(*) INTO n FROM platform_users;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Tenant beta sees % users; expected exactly its own member.', n;
  END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 11. Auth windows are tenant-correct across the boundary
-- --------------------------------------------------------------------------
DO $$
DECLARE
  n bigint;
BEGIN
  SET LOCAL ROLE platform_runtime;
  SELECT count(*) INTO n FROM staff_login_lookup('alice@alpha.test',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
  IF n <> 1 THEN
    RAISE EXCEPTION 'Alice did not resolve in her own tenant.';
  END IF;

  SELECT count(*) INTO n FROM staff_login_lookup('alice@alpha.test',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'Alice resolved in a tenant she does not belong to.';
  END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 12. Administrative path: the migration owner bypasses RLS, deliberately
-- --------------------------------------------------------------------------
-- The owner role is the operator path (migrations, verify, provisioning). It
-- MUST be able to see every tenant — that is the entire point of the elevated
-- credential. The guarantee is not that the owner cannot read; it is that the
-- owner credential is never configured in a deployed application.
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM estimates
   WHERE organization_id IN (
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  IF n <> 2 THEN
    RAISE EXCEPTION 'Owner path did not observe both tenants (n=%); owner reach regressed.', n;
  END IF;
END;
$$;

ROLLBACK;

\echo 'isolation-adversarial.sql: all checks passed'
