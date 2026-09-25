-- 037_signed_estimate_evidence_and_delivery.sql
--
-- REMEDIATION_PLAN.md P3.1 / P3.2 (docs/assurance/SIGNED_ESTIMATE_INVARIANTS.md).
--
-- 1. estimate_signed_evidence -- one immutable row per signed estimate holding
--    the EXACT canonical text that was hashed: estimate content, the governing
--    configuration version and the business identity/contact rendered to the
--    signer, the consent statement (text + version), signer name and time,
--    request metadata, and the delivery the signature came through. A CHECK
--    constraint makes the stored hash the SHA-256 of the stored text, so the
--    evidence is self-verifying in the database, and the estimate's own
--    content_hash must equal it (enforced at insert). Signed customer pages
--    render from this row, never from current configuration.
--
-- 2. estimate_deliveries + version-bound grants -- a delivery records the
--    draft's content hash; both customer links carry it (resource_version, also
--    bound into the HMAC token), so a draft edited after sending cannot be
--    signed through the old link.
--
-- 3. create_estimate_delivery() -- revoke previous links, record the delivery,
--    issue the view and sign grants and enqueue the outbox message (keyed by the
--    delivery id, which is also the provider idempotency key) in ONE
--    transaction. Best-effort compensating cleanup is gone: either all of it
--    commits or none of it does.

ALTER TABLE estimate_events
  DROP CONSTRAINT estimate_events_event_check,
  ADD CONSTRAINT estimate_events_event_check
    CHECK (event IN
      ('created', 'updated', 'signed', 'declined', 'duplicated',
       'job_linked', 'invoice_created', 'change_order_created',
       'change_order_approved', 'change_order_rejected', 'delivered'));

-- migrate:split

CREATE TABLE IF NOT EXISTS estimate_deliveries (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations (id) ON DELETE RESTRICT,
  estimate_id uuid NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  recipient_email text NOT NULL CHECK (char_length(recipient_email) BETWEEN 3 AND 320),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (estimate_id, organization_id)
    REFERENCES estimates (id, organization_id) ON DELETE RESTRICT
);

-- migrate:split

CREATE INDEX IF NOT EXISTS estimate_deliveries_estimate_idx
  ON estimate_deliveries (organization_id, estimate_id, created_at DESC);

-- migrate:split

CREATE TRIGGER estimate_deliveries_append_only
  BEFORE UPDATE OR DELETE ON estimate_deliveries
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- migrate:split

ALTER TABLE estimate_deliveries ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE estimate_deliveries FORCE ROW LEVEL SECURITY;
-- migrate:split
CREATE POLICY estimate_deliveries_tenant_isolation ON estimate_deliveries
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
-- migrate:split
GRANT SELECT, INSERT ON estimate_deliveries TO contractor_app;

-- migrate:split

ALTER TABLE customer_access_grants
  ADD COLUMN IF NOT EXISTS resource_version text
    CHECK (resource_version IS NULL OR resource_version ~ '^[a-f0-9]{64}$'),
  ADD COLUMN IF NOT EXISTS delivery_id uuid;

-- migrate:split

CREATE TABLE IF NOT EXISTS estimate_signed_evidence (
  estimate_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations (id) ON DELETE RESTRICT,
  configuration_version_id uuid REFERENCES configuration_versions (id) ON DELETE RESTRICT,
  delivery_id uuid,
  schema_version text NOT NULL CHECK (schema_version = 'signed-estimate-v1'),
  hash_algorithm text NOT NULL CHECK (hash_algorithm = 'sha256-canonical-json-v1'),
  canonical_text text NOT NULL CHECK (char_length(canonical_text) BETWEEN 2 AND 2000000),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  consent_text_version text NOT NULL CHECK (char_length(consent_text_version) BETWEEN 1 AND 60),
  signer_name text NOT NULL CHECK (char_length(signer_name) BETWEEN 1 AND 200),
  signed_at timestamptz NOT NULL,
  signer_ip text CHECK (signer_ip IS NULL OR char_length(signer_ip) <= 128),
  signer_user_agent text CHECK (signer_user_agent IS NULL OR char_length(signer_user_agent) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Self-verifying: the stored hash IS the digest of the stored text.
  CHECK (content_hash = encode(sha256(convert_to(canonical_text, 'UTF8')), 'hex')),
  FOREIGN KEY (estimate_id, organization_id)
    REFERENCES estimates (id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (delivery_id, organization_id)
    REFERENCES estimate_deliveries (id, organization_id) ON DELETE RESTRICT
);

-- migrate:split

CREATE TRIGGER estimate_signed_evidence_append_only
  BEFORE UPDATE OR DELETE ON estimate_signed_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- The evidence must describe the estimate as it was signed: same hash, and the
-- estimate must already be in its signed state in this transaction.
CREATE OR REPLACE FUNCTION enforce_signed_evidence_matches_estimate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM estimates
    WHERE id = NEW.estimate_id
      AND organization_id = NEW.organization_id
      AND status = 'signed'
      AND content_hash = NEW.content_hash
  ) THEN
    RAISE EXCEPTION 'Signed evidence does not match estimate % (status/hash).', NEW.estimate_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- migrate:split

CREATE TRIGGER estimate_signed_evidence_matches_estimate
  BEFORE INSERT ON estimate_signed_evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_signed_evidence_matches_estimate();

-- migrate:split

ALTER TABLE estimate_signed_evidence ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE estimate_signed_evidence FORCE ROW LEVEL SECURITY;
-- migrate:split
CREATE POLICY estimate_signed_evidence_tenant_isolation ON estimate_signed_evidence
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
-- migrate:split
GRANT SELECT, INSERT ON estimate_signed_evidence TO contractor_app;

-- migrate:split

-- One transaction for the whole delivery. SECURITY INVOKER: runs as
-- contractor_app under the caller's tenant context, so RLS scopes every row.
-- The caller computes tokens (HMAC keys never reach the database) and passes
-- only their hashes.
CREATE OR REPLACE FUNCTION create_estimate_delivery(
  p_delivery_id uuid,
  p_estimate_id uuid,
  p_expected_updated_at timestamptz,
  p_content_hash text,
  p_recipient_email text,
  p_customer_id uuid,
  p_view_grant_id uuid,
  p_view_token_hash text,
  p_sign_grant_id uuid,
  p_sign_token_hash text,
  p_key_version text,
  p_expires_at timestamptz,
  p_created_by uuid,
  p_outbox_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Lock the estimate and prove it is still the draft whose hash was computed.
  PERFORM 1 FROM estimates
  WHERE id = p_estimate_id AND status = 'draft' AND updated_at = p_expected_updated_at
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'estimate_changed: the estimate is no longer the draft being sent'
      USING ERRCODE = 'serialization_failure';
  END IF;

  UPDATE customer_access_grants
  SET status = 'revoked', revoked_at = now(), updated_at = now()
  WHERE document_type = 'estimate' AND document_id = p_estimate_id AND status = 'active';

  INSERT INTO estimate_deliveries (id, estimate_id, content_hash, recipient_email, created_by)
  VALUES (p_delivery_id, p_estimate_id, p_content_hash, p_recipient_email, p_created_by);

  INSERT INTO customer_access_grants
    (id, organization_id, customer_id, document_type, document_id, purpose, token_hash,
     key_version, status, expires_at, created_by, resource_version, delivery_id)
  VALUES
    (p_view_grant_id, app_require_organization_id(), p_customer_id, 'estimate', p_estimate_id, 'view',
     p_view_token_hash, p_key_version, 'active', p_expires_at, p_created_by, p_content_hash, p_delivery_id),
    (p_sign_grant_id, app_require_organization_id(), p_customer_id, 'estimate', p_estimate_id, 'sign',
     p_sign_token_hash, p_key_version, 'active', p_expires_at, p_created_by, p_content_hash, p_delivery_id);

  INSERT INTO transactional_outbox (organization_id, topic, key, payload)
  VALUES (app_require_organization_id(), 'estimate_delivery', p_delivery_id::text, p_outbox_payload);

  INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
  VALUES (app_require_organization_id(), p_estimate_id, 'delivered', p_created_by,
          jsonb_build_object('delivery_id', p_delivery_id, 'content_hash', p_content_hash));
END;
$$;

-- migrate:split

GRANT EXECUTE ON FUNCTION create_estimate_delivery(
  uuid, uuid, timestamptz, text, text, uuid, uuid, text, uuid, text, text, timestamptz, uuid, jsonb
) TO contractor_app;
