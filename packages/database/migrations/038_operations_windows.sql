-- 038_operations_windows.sql
--
-- REMEDIATION_PLAN.md P5 operator windows (control_app only, audited):
--
--   control_tenant_health(org)   per-tenant health: lifecycle, domains,
--                                configuration, staff and MFA coverage, outbox
--                                backlog/dead rows, and the last successful
--                                critical operations (sign-in, delivery,
--                                signature). Counts and timestamps only.
--   control_revoke_customer_links(operator, org, document, reason)
--                                incident response: revoke every active
--                                customer link of a tenant (or of one
--                                document) in one audited statement.

CREATE OR REPLACE FUNCTION control_tenant_health(p_organization_id uuid)
RETURNS TABLE (
  organization_status text,
  canonical_domain_verified boolean,
  custom_domains_unverified bigint,
  configuration_approved boolean,
  active_staff bigint,
  staff_with_mfa bigint,
  outbox_pending bigint,
  outbox_oldest_pending_seconds bigint,
  outbox_dead bigint,
  last_sign_in_at timestamptz,
  last_delivery_at timestamptz,
  last_signature_at timestamptz,
  active_customer_links bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.status,
    coalesce((SELECT bool_or(d.verified) FROM organization_domains d WHERE d.organization_id = o.id AND d.is_canonical), false),
    (SELECT count(*) FROM organization_domains d WHERE d.organization_id = o.id AND NOT d.is_canonical AND NOT d.verified),
    EXISTS (SELECT 1 FROM configuration_versions c WHERE c.organization_id = o.id AND c.status = 'approved' AND c.superseded_at IS NULL),
    (SELECT count(*) FROM organization_memberships m WHERE m.organization_id = o.id AND m.status = 'active'),
    (SELECT count(*) FROM organization_memberships m WHERE m.organization_id = o.id AND m.status = 'active' AND m.mfa_required),
    (SELECT count(*) FROM transactional_outbox x WHERE x.organization_id = o.id AND x.status IN ('pending', 'failed')),
    coalesce((SELECT extract(epoch FROM now() - min(x.created_at))::bigint FROM transactional_outbox x
               WHERE x.organization_id = o.id AND x.status IN ('pending', 'failed')), 0),
    (SELECT count(*) FROM transactional_outbox x WHERE x.organization_id = o.id AND x.status = 'dead'),
    (SELECT max(s.issued_at) FROM field_sessions s WHERE s.organization_id = o.id),
    (SELECT max(d.created_at) FROM estimate_deliveries d WHERE d.organization_id = o.id),
    (SELECT max(e.signed_at) FROM estimate_signed_evidence e WHERE e.organization_id = o.id),
    (SELECT count(*) FROM customer_access_grants g WHERE g.organization_id = o.id AND g.status = 'active' AND g.expires_at > now())
  FROM organizations o
  WHERE o.id = p_organization_id
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION control_revoke_customer_links(
  p_operator text,
  p_organization_id uuid,
  p_document_id uuid,
  p_reason text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  revoked bigint;
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE customer_access_grants
  SET status = 'revoked', revoked_at = now(), updated_at = now()
  WHERE organization_id = p_organization_id
    AND status = 'active'
    AND (p_document_id IS NULL OR document_id = p_document_id);
  GET DIAGNOSTICS revoked = ROW_COUNT;

  INSERT INTO identity_audit_events (actor, action, organization_id, detail)
  VALUES (p_operator, 'links.revoke', p_organization_id,
          jsonb_build_object('document_id', p_document_id, 'revoked', revoked, 'reason', p_reason));
  RETURN revoked;
END;
$$;

-- migrate:split

GRANT EXECUTE ON FUNCTION
  control_tenant_health(uuid),
  control_revoke_customer_links(text, uuid, uuid, text)
TO control_app;
