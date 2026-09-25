-- 036_domain_verification.sql
--
-- Custom-domain verification was not verification: both the control-plane and
-- the tenant (Field) "verify" paths marked a hostname verified without any DNS
-- check, and the TXT "challenge" they displayed was generated per request and
-- never stored, so it could not have been checked. A verified hostname is the
-- tenant boundary (resolve_verified_organization), so an unproven claim could
-- route another business's domain -- and its customers' leads -- to the wrong
-- tenant.
--
-- The tenant path also never worked: contractor_app held table grants but
-- only a SELECT policy, so add/verify/remove failed at RLS.
--
-- Now:
--   - each custom domain stores its verification token (public by design:
--     it is published in DNS; what matters is that it is fixed per domain);
--   - the application proves the TXT record `_jbox-verify.<hostname>` =
--     `jbox-verify=<token>` exists before calling the mark-verified window,
--     which requires the stored token;
--   - tenants add/verify/remove their OWN non-canonical domains only through
--     SECURITY DEFINER windows scoped by app_require_organization_id();
--   - direct DML grants that RLS was silently refusing are revoked.

ALTER TABLE organization_domains
  ADD COLUMN IF NOT EXISTS verification_token text
    CHECK (verification_token IS NULL OR verification_token ~ '^[a-f0-9]{32}$');

-- migrate:split

UPDATE organization_domains
SET verification_token = replace(gen_random_uuid()::text, '-', '')
WHERE NOT is_canonical AND NOT verified AND verification_token IS NULL;

-- migrate:split

REVOKE INSERT, UPDATE, DELETE ON organization_domains FROM contractor_app, platform_runtime;

-- migrate:split

CREATE OR REPLACE FUNCTION tenant_domain_add(p_hostname text)
RETURNS TABLE (id uuid, hostname text, verification_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_host text := lower(btrim(p_hostname));
BEGIN
  IF v_host !~ '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' THEN
    RAISE EXCEPTION 'hostname is not a valid domain' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_host = 'usejbox.com' OR v_host LIKE '%.usejbox.com' THEN
    RAISE EXCEPTION 'platform hostnames cannot be claimed' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  INSERT INTO organization_domains (organization_id, hostname, is_canonical, verified, verification_token)
  VALUES (app_require_organization_id(), v_host, false, false, replace(gen_random_uuid()::text, '-', ''))
  RETURNING organization_domains.id, organization_domains.hostname, organization_domains.verification_token;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION tenant_domain_challenge(p_domain_id uuid)
RETURNS TABLE (hostname text, verification_token text, verified boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.hostname, d.verification_token, d.verified
  FROM organization_domains AS d
  WHERE d.id = p_domain_id
    AND d.organization_id = app_require_organization_id()
    AND NOT d.is_canonical
$$;

-- migrate:split

-- Called only after the application observed the TXT record. The stored token
-- must match what was checked, so a stale or foreign token cannot verify.
CREATE OR REPLACE FUNCTION tenant_domain_mark_verified(p_domain_id uuid, p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organization_domains
  SET verified = true, verified_at = now()
  WHERE id = p_domain_id
    AND organization_id = app_require_organization_id()
    AND NOT is_canonical
    AND verification_token = p_token;
  RETURN FOUND;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION tenant_domain_remove(p_domain_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM organization_domains
  WHERE id = p_domain_id
    AND organization_id = app_require_organization_id()
    AND NOT is_canonical;
  RETURN FOUND;
END;
$$;

-- migrate:split

GRANT EXECUTE ON FUNCTION
  tenant_domain_add(text),
  tenant_domain_challenge(uuid),
  tenant_domain_mark_verified(uuid, text),
  tenant_domain_remove(uuid)
TO contractor_app;
