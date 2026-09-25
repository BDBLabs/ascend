-- signed-evidence.sql
--
-- P3.1 / P3.2 database guarantees (migration 037):
--   1. evidence is self-verifying: a row whose hash is not the SHA-256 of its
--      text is refused;
--   2. evidence can only describe a signed estimate carrying the same hash;
--   3. evidence and deliveries are append-only;
--   4. create_estimate_delivery is all-or-nothing and refuses a draft that
--      changed since its hash was computed; a new delivery revokes the old
--      links; everything it writes is tenant-scoped.
--
-- Runs as the owner inside one transaction that ROLLs BACK.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE control_app;
INSERT INTO organizations (id, slug, display_name, status) VALUES
  ('e1e1e1e1-0000-0000-0000-00000000000a', 'evidence-alpha', 'Evidence Alpha', 'active'),
  ('e1e1e1e1-0000-0000-0000-00000000000b', 'evidence-beta',  'Evidence Beta',  'active');
RESET ROLE;

CREATE TEMP TABLE ev (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON ev TO PUBLIC;

DO $$
DECLARE
  customer uuid;
  estimate uuid;
  stamp timestamptz;
BEGIN
  PERFORM set_application_context('e1e1e1e1-0000-0000-0000-00000000000a'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  INSERT INTO customers (document_number, display_id, display_name)
    VALUES (allocate_document_number('customer'), 'EV-CUS-0001', 'Evidence Customer')
    RETURNING id INTO customer;
  INSERT INTO estimates (document_number, display_id, customer_id, title)
    VALUES (allocate_document_number('estimate'), 'EV-EST-0001', customer, 'Panel upgrade')
    RETURNING id, updated_at INTO estimate, stamp;
  RESET ROLE;
  INSERT INTO ev VALUES ('customer', customer::text), ('estimate', estimate::text), ('stamp', stamp::text);
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Delivery: stale draft refused, nothing persisted
-- --------------------------------------------------------------------------
DO $$
DECLARE
  estimate uuid := (SELECT v FROM ev WHERE k = 'estimate')::uuid;
  customer uuid := (SELECT v FROM ev WHERE k = 'customer')::uuid;
  raised boolean := false;
  n int;
BEGIN
  PERFORM set_application_context('e1e1e1e1-0000-0000-0000-00000000000a'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  BEGIN
    PERFORM create_estimate_delivery(
      gen_random_uuid(), estimate, now() - interval '1 day', repeat('a', 64), 'c@example.test', customer,
      gen_random_uuid(), repeat('1', 64), gen_random_uuid(), repeat('2', 64), 'v1',
      now() + interval '14 days', NULL, '{"displayId":"EV-EST-0001"}'::jsonb);
  EXCEPTION WHEN serialization_failure THEN
    raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'A delivery was created for a draft that changed.'; END IF;
  SELECT count(*) INTO n FROM estimate_deliveries WHERE estimate_id = estimate;
  IF n <> 0 THEN RAISE EXCEPTION 'A refused delivery left a delivery row behind.'; END IF;
  SELECT count(*) INTO n FROM customer_access_grants WHERE document_id = estimate;
  IF n <> 0 THEN RAISE EXCEPTION 'A refused delivery left grants behind.'; END IF;
  RESET ROLE;
END;
$$;

-- Happy path, then a second delivery revokes the first links.
DO $$
DECLARE
  estimate uuid := (SELECT v FROM ev WHERE k = 'estimate')::uuid;
  customer uuid := (SELECT v FROM ev WHERE k = 'customer')::uuid;
  stamp timestamptz := (SELECT v FROM ev WHERE k = 'stamp')::timestamptz;
  first_delivery uuid := gen_random_uuid();
  second_delivery uuid := gen_random_uuid();
  n int;
BEGIN
  PERFORM set_application_context('e1e1e1e1-0000-0000-0000-00000000000a'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  PERFORM create_estimate_delivery(
    first_delivery, estimate, stamp, repeat('a', 64), 'c@example.test', customer,
    gen_random_uuid(), repeat('1', 64), gen_random_uuid(), repeat('2', 64), 'v1',
    now() + interval '14 days', NULL, '{"displayId":"EV-EST-0001"}'::jsonb);

  SELECT count(*) INTO n FROM customer_access_grants
   WHERE document_id = estimate AND status = 'active' AND resource_version = repeat('a', 64)
     AND delivery_id = first_delivery;
  IF n <> 2 THEN RAISE EXCEPTION 'A delivery did not issue two version-bound grants (got %).', n; END IF;
  SELECT count(*) INTO n FROM transactional_outbox WHERE key = first_delivery::text AND topic = 'estimate_delivery';
  IF n <> 1 THEN RAISE EXCEPTION 'A delivery did not enqueue exactly one message keyed by its id.'; END IF;
  SELECT count(*) INTO n FROM estimate_events WHERE estimate_id = estimate AND event = 'delivered';
  IF n <> 1 THEN RAISE EXCEPTION 'A delivery was not recorded as an estimate event.'; END IF;

  PERFORM create_estimate_delivery(
    second_delivery, estimate, stamp, repeat('a', 64), 'c@example.test', customer,
    gen_random_uuid(), repeat('3', 64), gen_random_uuid(), repeat('4', 64), 'v1',
    now() + interval '14 days', NULL, '{"displayId":"EV-EST-0001"}'::jsonb);
  SELECT count(*) INTO n FROM customer_access_grants
   WHERE delivery_id = first_delivery AND status = 'revoked';
  IF n <> 2 THEN RAISE EXCEPTION 'A new delivery did not revoke the previous links.'; END IF;
  RESET ROLE;

  -- Tenant beta sees none of it.
  PERFORM set_application_context('e1e1e1e1-0000-0000-0000-00000000000b'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT count(*) INTO n FROM estimate_deliveries;
  IF n <> 0 THEN RAISE EXCEPTION 'Tenant beta read tenant alpha''s deliveries.'; END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 1-3. Evidence
-- --------------------------------------------------------------------------
DO $$
DECLARE
  estimate uuid := (SELECT v FROM ev WHERE k = 'estimate')::uuid;
  body text := '{"schema":"signed-estimate-v1","signature":{"signerName":"Pat"}}';
  digest text := encode(sha256(convert_to('{"schema":"signed-estimate-v1","signature":{"signerName":"Pat"}}', 'UTF8')), 'hex');
  raised boolean;
BEGIN
  PERFORM set_application_context('e1e1e1e1-0000-0000-0000-00000000000a'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  -- Evidence for an unsigned estimate is refused.
  raised := false;
  BEGIN
    INSERT INTO estimate_signed_evidence (estimate_id, schema_version, hash_algorithm, canonical_text,
      content_hash, consent_text_version, signer_name, signed_at)
    VALUES (estimate, 'signed-estimate-v1', 'sha256-canonical-json-v1', body, digest, 'estimate-consent-v1', 'Pat', now());
  EXCEPTION WHEN integrity_constraint_violation THEN raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'Evidence was recorded for an unsigned estimate.'; END IF;

  UPDATE estimates SET status = 'signed', signed_by_name = 'Pat', signed_at = now(), content_hash = digest,
         customer_name = 'Evidence Customer'
  WHERE id = estimate;

  -- A hash that is not the digest of the text is refused.
  raised := false;
  BEGIN
    INSERT INTO estimate_signed_evidence (estimate_id, schema_version, hash_algorithm, canonical_text,
      content_hash, consent_text_version, signer_name, signed_at)
    VALUES (estimate, 'signed-estimate-v1', 'sha256-canonical-json-v1', body || ' ', digest, 'estimate-consent-v1', 'Pat', now());
  EXCEPTION WHEN check_violation THEN raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'Evidence whose hash does not match its text was accepted.'; END IF;

  INSERT INTO estimate_signed_evidence (estimate_id, schema_version, hash_algorithm, canonical_text,
    content_hash, consent_text_version, signer_name, signed_at)
  VALUES (estimate, 'signed-estimate-v1', 'sha256-canonical-json-v1', body, digest, 'estimate-consent-v1', 'Pat', now());

  -- Append-only.
  raised := false;
  BEGIN
    UPDATE estimate_signed_evidence SET signer_name = 'Mallory' WHERE estimate_id = estimate;
  EXCEPTION WHEN OTHERS THEN raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'Signed evidence was mutable.'; END IF;
  raised := false;
  BEGIN
    DELETE FROM estimate_signed_evidence WHERE estimate_id = estimate;
  EXCEPTION WHEN OTHERS THEN raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'Signed evidence was deletable.'; END IF;
  RESET ROLE;

  -- Tenant beta cannot read it.
  PERFORM set_application_context('e1e1e1e1-0000-0000-0000-00000000000b'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  IF EXISTS (SELECT 1 FROM estimate_signed_evidence) THEN
    RAISE EXCEPTION 'Tenant beta read tenant alpha''s signed evidence.';
  END IF;
  RESET ROLE;
END;
$$;

ROLLBACK;

\echo 'signed-evidence.sql: all checks passed'
