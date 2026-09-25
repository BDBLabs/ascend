-- 035_native_auth_lifecycle.sql
--
-- REMEDIATION_PLAN.md P2 (native-auth semantics) plus the unauthenticated
-- organization-creation window found alongside it.
--
-- 1. REMOVE create_organization_with_trade. /api/platform/jbox-setup called it
--    anonymously: it created ACTIVE organizations, and ON CONFLICT (slug)
--    rewrote an existing tenant's trade and returned its id. Onboarding goes
--    through the control plane (provisioning state, rate limited) instead.
--    platform_runtime's USING (true) policies on the canvas tables existed only
--    for it and are dropped too.
--
-- 2. IDENTITY vs MEMBERSHIP (P2.1). Native memberships carried
--    clerk_membership_id = 'native-' || user_id -- the same value in every
--    organization. The column becomes a nullable provider-qualified external
--    id; the membership's identity is its own primary key.
--    provision_staff_member (a global upsert that reset any user's password and
--    reactivated any user from ANY tenant's provisioning call) is removed. Staff
--    provisioning becomes audited control-plane operator actions that change
--    only the named organization's membership; global identity changes
--    (suspend/reactivate, cross-tenant password reset) are separate, explicit,
--    audited platform actions.
--
-- 3. SESSION LIFECYCLE (P2.2). platform_users.auth_version and
--    organization_memberships.auth_version are monotonic and bumped by triggers
--    whenever credential/status/role/MFA state changes; the same triggers revoke
--    the affected sessions in the same transaction. A session records both
--    versions at issue and validates only while they are unchanged, so no
--    suspend -> reactivate (or revoke -> re-provision) sequence can revive an
--    old token. Decision: role changes force re-login. Sessions are issued,
--    validated and revoked only through SECURITY DEFINER functions;
--    platform_runtime loses direct DML on field_sessions.
--
-- 4. ACCOUNT CONTROLS (P2.3).
--    - MFA works end to end: enrollment writes a PENDING secret and cannot
--      overwrite an active one (previously any session could replace the
--      global TOTP secret protecting the user's other organizations), and
--      completion/disable no longer read platform_users directly (which
--      platform_runtime cannot, so both always failed). TOTP time steps are
--      single-use (replay protection).
--    - Deployment-wide lockout: 10 consecutive failures lock the account for
--      15 minutes, in the database rather than per-instance memory.
--    - Reset/recovery: operator-issued, single-use, hashed, expiring tokens
--      (also used for a new staff member's initial password); consuming one
--      rotates the credential and revokes every session.
--    - Password rehash-on-login without revoking sessions.
--    - identity_audit_events records every identity mutation with its actor.

-- ---------------------------------------------------------------------------
-- 1. Remove the anonymous organization-creation window
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_organization_with_trade(text, text, text);

-- migrate:split

DROP POLICY IF EXISTS canvas_symbol_definitions_platform_all ON canvas_symbol_definitions;

-- migrate:split

DROP POLICY IF EXISTS tenant_canvas_symbols_platform_all ON tenant_canvas_symbols;

-- migrate:split

REVOKE ALL ON canvas_symbol_definitions, tenant_canvas_symbols FROM platform_runtime;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 2. Identity schema
-- ---------------------------------------------------------------------------

ALTER TABLE organization_memberships ALTER COLUMN clerk_membership_id DROP NOT NULL;

-- migrate:split

UPDATE organization_memberships
SET clerk_membership_id = NULL
WHERE clerk_membership_id LIKE 'native-%';

-- migrate:split

ALTER TABLE organization_memberships
  ADD COLUMN IF NOT EXISTS auth_version bigint NOT NULL DEFAULT 1 CHECK (auth_version >= 1);

-- migrate:split

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS auth_version bigint NOT NULL DEFAULT 1 CHECK (auth_version >= 1),
  ADD COLUMN IF NOT EXISTS totp_pending_secret text
    CHECK (totp_pending_secret IS NULL OR char_length(totp_pending_secret) = 32),
  ADD COLUMN IF NOT EXISTS totp_last_step bigint,
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

-- migrate:split

ALTER TABLE field_sessions
  ADD COLUMN IF NOT EXISTS membership_id uuid,
  ADD COLUMN IF NOT EXISTS user_auth_version bigint,
  ADD COLUMN IF NOT EXISTS membership_auth_version bigint;

-- migrate:split

-- Sessions issued before versioning cannot be validated under the new rule.
UPDATE field_sessions SET revoked_at = now() WHERE revoked_at IS NULL;

-- migrate:split

CREATE TABLE IF NOT EXISTS identity_audit_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL CHECK (char_length(actor) BETWEEN 1 AND 200),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  organization_id uuid REFERENCES organizations (id) ON DELETE RESTRICT,
  platform_user_id uuid REFERENCES platform_users (id) ON DELETE RESTRICT,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object')
);

-- migrate:split

CREATE INDEX IF NOT EXISTS identity_audit_events_org_idx
  ON identity_audit_events (organization_id, occurred_at DESC);

-- migrate:split

CREATE INDEX IF NOT EXISTS identity_audit_events_user_idx
  ON identity_audit_events (platform_user_id, occurred_at DESC);

-- migrate:split

CREATE TRIGGER identity_audit_events_append_only
  BEFORE UPDATE OR DELETE ON identity_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

ALTER TABLE identity_audit_events ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE identity_audit_events FORCE ROW LEVEL SECURITY;
-- migrate:split
CREATE POLICY identity_audit_events_control_reads ON identity_audit_events
  FOR SELECT TO control_app USING (true);
-- migrate:split
REVOKE ALL ON identity_audit_events FROM PUBLIC, contractor_app, platform_runtime;
-- migrate:split
GRANT SELECT ON identity_audit_events TO control_app;

-- migrate:split

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid NOT NULL REFERENCES platform_users (id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('initial', 'reset')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  issued_by text NOT NULL CHECK (char_length(issued_by) BETWEEN 1 AND 200),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (platform_user_id) WHERE consumed_at IS NULL;

-- migrate:split

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
-- migrate:split
REVOKE ALL ON password_reset_tokens FROM PUBLIC, contractor_app, control_app, platform_runtime;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 3. Version triggers: every credential/status/role/MFA change bumps the
--    version and revokes the affected sessions in the same transaction.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bump_platform_user_auth_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.auth_version < OLD.auth_version THEN
    RAISE EXCEPTION 'auth_version is monotonic.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.password_hash IS DISTINCT FROM OLD.password_hash
        AND coalesce(current_setting('ascend.password_rehash', true), '') <> 'on')
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.identity_deleted_at IS DISTINCT FROM OLD.identity_deleted_at
     OR NEW.totp_secret IS DISTINCT FROM OLD.totp_secret
     OR NEW.email IS DISTINCT FROM OLD.email
  THEN
    NEW.auth_version := OLD.auth_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

-- migrate:split

CREATE TRIGGER platform_users_auth_version
  BEFORE UPDATE ON platform_users
  FOR EACH ROW
  EXECUTE FUNCTION bump_platform_user_auth_version();

-- migrate:split

CREATE OR REPLACE FUNCTION bump_membership_auth_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.auth_version < OLD.auth_version THEN
    RAISE EXCEPTION 'auth_version is monotonic.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.mfa_required IS DISTINCT FROM OLD.mfa_required
     OR NEW.platform_user_id IS DISTINCT FROM OLD.platform_user_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
  THEN
    NEW.auth_version := OLD.auth_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

-- migrate:split

CREATE TRIGGER organization_memberships_auth_version
  BEFORE UPDATE ON organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION bump_membership_auth_version();

-- migrate:split

-- The revocation side effects run as the owner: the role making the identity
-- change (control_app, platform_runtime) must not need DML on field_sessions.
CREATE OR REPLACE FUNCTION revoke_sessions_after_user_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE field_sessions
  SET revoked_at = now()
  WHERE platform_user_id = NEW.id AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;

-- migrate:split

CREATE TRIGGER platform_users_revoke_sessions
  AFTER UPDATE ON platform_users
  FOR EACH ROW
  WHEN (NEW.auth_version <> OLD.auth_version)
  EXECUTE FUNCTION revoke_sessions_after_user_change();

-- migrate:split

CREATE OR REPLACE FUNCTION revoke_sessions_after_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE field_sessions
  SET revoked_at = now()
  WHERE platform_user_id = OLD.platform_user_id
    AND organization_id = OLD.organization_id
    AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;

-- migrate:split

CREATE TRIGGER organization_memberships_revoke_sessions
  AFTER UPDATE ON organization_memberships
  FOR EACH ROW
  WHEN (NEW.auth_version <> OLD.auth_version)
  EXECUTE FUNCTION revoke_sessions_after_membership_change();

-- migrate:split

CREATE TRIGGER organization_memberships_revoke_sessions_on_delete
  AFTER DELETE ON organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION revoke_sessions_after_membership_change();

-- migrate:split

CREATE OR REPLACE FUNCTION revoke_sessions_after_organization_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE field_sessions
  SET revoked_at = now()
  WHERE organization_id = NEW.id AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;

-- migrate:split

CREATE TRIGGER organizations_revoke_sessions
  AFTER UPDATE ON organizations
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION revoke_sessions_after_organization_change();

-- migrate:split

-- ---------------------------------------------------------------------------
-- 4. Sessions: issued, validated and revoked only through these windows
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS field_sessions_platform_manages ON field_sessions;

-- migrate:split

REVOKE ALL ON field_sessions FROM platform_runtime;

-- migrate:split

DROP FUNCTION IF EXISTS staff_session_membership(uuid, uuid);

-- migrate:split

-- Issues a session bound to the CURRENT user and membership versions. Returns
-- no row when the user, membership or organization is not active.
CREATE OR REPLACE FUNCTION staff_session_issue(
  p_jti text,
  p_user_id uuid,
  p_organization_id uuid,
  p_ttl_seconds integer
)
RETURNS TABLE (membership_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_jti IS NULL OR char_length(p_jti) NOT BETWEEN 16 AND 128 THEN
    RAISE EXCEPTION 'invalid jti' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 60 AND 86400 THEN
    RAISE EXCEPTION 'session ttl out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  INSERT INTO field_sessions (
    jti, platform_user_id, organization_id, membership_id, role,
    user_auth_version, membership_auth_version, issued_at, expires_at
  )
  SELECT p_jti, u.id, m.organization_id, m.id, m.role,
         u.auth_version, m.auth_version, now(), now() + make_interval(secs => p_ttl_seconds)
  FROM platform_users AS u
  JOIN organization_memberships AS m ON m.platform_user_id = u.id
  JOIN organizations AS o ON o.id = m.organization_id
  WHERE u.id = p_user_id
    AND m.organization_id = p_organization_id
    AND u.status = 'active' AND u.identity_deleted_at IS NULL
    AND m.status = 'active'
    AND o.status = 'active'
  RETURNING field_sessions.membership_id, field_sessions.expires_at;
END;
$$;

-- migrate:split

-- The only way a token becomes a principal: the session row must exist, be
-- unrevoked and unexpired, belong to this user and organization, and carry the
-- user's and membership's current auth versions.
CREATE OR REPLACE FUNCTION staff_session_validate(
  p_jti text,
  p_user_id uuid,
  p_organization_id uuid
)
RETURNS TABLE (
  membership_id uuid,
  role text,
  mfa_required boolean,
  display_name text,
  email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id, m.role, m.mfa_required, u.display_name, u.email
  FROM field_sessions AS s
  JOIN platform_users AS u ON u.id = s.platform_user_id
  JOIN organization_memberships AS m
    ON m.id = s.membership_id AND m.platform_user_id = u.id
  JOIN organizations AS o ON o.id = m.organization_id
  WHERE s.jti = p_jti
    AND s.platform_user_id = p_user_id
    AND s.organization_id = p_organization_id
    AND m.organization_id = p_organization_id
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND s.user_auth_version = u.auth_version
    AND s.membership_auth_version = m.auth_version
    AND u.status = 'active' AND u.identity_deleted_at IS NULL
    AND m.status = 'active'
    AND o.status = 'active'
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION staff_session_revoke(p_jti text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE field_sessions SET revoked_at = now()
  WHERE jti = p_jti AND revoked_at IS NULL;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 5. Login: lockout, credential lookup, rehash
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS staff_login_lookup(text, uuid);

-- migrate:split

CREATE FUNCTION staff_login_lookup(p_email text, p_organization_id uuid)
RETURNS TABLE (
  platform_user_id uuid,
  email text,
  display_name text,
  password_hash text,
  membership_id uuid,
  role text,
  mfa_required boolean,
  totp_secret text,
  locked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email, u.display_name, u.password_hash, m.id, m.role,
         m.mfa_required, u.totp_secret,
         coalesce(u.locked_until > now(), false)
  FROM platform_users AS u
  JOIN organization_memberships AS m ON m.platform_user_id = u.id
  JOIN organizations AS o ON o.id = m.organization_id
  WHERE u.email = lower(p_email)
    AND m.organization_id = p_organization_id
    AND u.status = 'active' AND u.identity_deleted_at IS NULL
    AND m.status = 'active'
    AND o.status = 'active'
  LIMIT 1
$$;

-- migrate:split

-- Organization choices for a multi-organization login (shown only after the
-- password was verified). Returns the organization's name for the picker and,
-- unlike the 015 version, no TOTP secret.
DROP FUNCTION IF EXISTS staff_memberships_for_email(text);

-- migrate:split

CREATE FUNCTION staff_memberships_for_email(p_email text)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  membership_id uuid,
  role text,
  mfa_required boolean,
  display_name text,
  email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.organization_id, o.display_name, m.id, m.role, m.mfa_required, u.display_name, u.email
  FROM platform_users AS u
  JOIN organization_memberships AS m ON m.platform_user_id = u.id
  JOIN organizations AS o ON o.id = m.organization_id
  WHERE u.email = lower(p_email)
    AND u.status = 'active' AND u.identity_deleted_at IS NULL
    AND m.status = 'active'
    AND o.status = 'active'
  ORDER BY o.display_name, m.id
$$;

-- migrate:split

-- Deployment-wide lockout (not per-instance memory): 10 consecutive failures
-- lock the account for 15 minutes. Unknown emails are a no-op, and the caller
-- answers every failure identically, so the counter reveals nothing.
CREATE OR REPLACE FUNCTION staff_login_failure(p_email text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE platform_users
  SET failed_login_count = failed_login_count + 1,
      locked_until = CASE WHEN failed_login_count + 1 >= 10
                          THEN now() + interval '15 minutes'
                          ELSE locked_until END
  WHERE email = lower(p_email);
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION staff_login_success(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE platform_users
  SET failed_login_count = 0, locked_until = NULL
  WHERE id = p_user_id AND (failed_login_count <> 0 OR locked_until IS NOT NULL);
$$;

-- migrate:split

-- Upgrades a hash to current parameters after a successful login. Compare-
-- and-set on the old hash; flagged as a rehash so it does not bump the version
-- (the credential itself did not change) and so does not revoke sessions.
CREATE OR REPLACE FUNCTION staff_password_rehash(
  p_user_id uuid,
  p_expected_hash text,
  p_new_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('ascend.password_rehash', 'on', true);
  UPDATE platform_users SET password_hash = p_new_hash, updated_at = now()
  WHERE id = p_user_id AND password_hash = p_expected_hash;
  PERFORM set_config('ascend.password_rehash', 'off', true);
  RETURN FOUND;
END;
$$;

-- migrate:split

-- Authenticated self-service change: the caller verified the current password
-- against p_expected_hash; compare-and-set so a concurrent change wins cleanly.
CREATE OR REPLACE FUNCTION staff_password_change(
  p_user_id uuid,
  p_expected_hash text,
  p_new_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users
  SET password_hash = p_new_hash, password_changed_at = now(),
      failed_login_count = 0, locked_until = NULL, updated_at = now()
  WHERE id = p_user_id AND password_hash = p_expected_hash
    AND status = 'active' AND identity_deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE password_reset_tokens SET consumed_at = now()
  WHERE platform_user_id = p_user_id AND consumed_at IS NULL;

  INSERT INTO identity_audit_events (actor, action, platform_user_id)
  VALUES ('self', 'password.change', p_user_id);
  RETURN true;
END;
$$;

-- migrate:split

-- Consumes a single-use reset/initial token. Returns the user id, or NULL when
-- the token is unknown, used, or expired (all indistinguishable to the caller).
CREATE OR REPLACE FUNCTION staff_password_reset_consume(
  p_token_hash text,
  p_new_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  token password_reset_tokens%ROWTYPE;
BEGIN
  SELECT * INTO token FROM password_reset_tokens
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND OR token.consumed_at IS NOT NULL OR token.expires_at <= now() THEN
    RETURN NULL;
  END IF;

  UPDATE platform_users
  SET password_hash = p_new_hash, password_changed_at = now(),
      failed_login_count = 0, locked_until = NULL, updated_at = now()
  WHERE id = token.platform_user_id
    AND status = 'active' AND identity_deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE password_reset_tokens SET consumed_at = now()
  WHERE platform_user_id = token.platform_user_id AND consumed_at IS NULL;

  INSERT INTO identity_audit_events (actor, action, organization_id, platform_user_id, detail)
  VALUES ('self', 'password.' || token.purpose, token.organization_id, token.platform_user_id,
          jsonb_build_object('token_id', token.id, 'issued_by', token.issued_by));
  RETURN token.platform_user_id;
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 6. MFA
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION staff_mfa_state(p_user_id uuid)
RETURNS TABLE (totp_secret text, totp_pending_secret text, totp_last_step bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.totp_secret, u.totp_pending_secret, u.totp_last_step
  FROM platform_users AS u
  WHERE u.id = p_user_id AND u.status = 'active' AND u.identity_deleted_at IS NULL
$$;

-- migrate:split

-- Starts enrollment with a PENDING secret. Never replaces an active secret:
-- the TOTP secret is per user, and it may already protect another org.
CREATE OR REPLACE FUNCTION staff_mfa_initiate(p_user_id uuid, p_totp_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users
  SET totp_pending_secret = p_totp_secret, updated_at = now()
  WHERE id = p_user_id
    AND status = 'active' AND identity_deleted_at IS NULL
    AND totp_secret IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'totp_already_enrolled' USING ERRCODE = 'unique_violation';
  END IF;
END;
$$;

-- migrate:split

-- Marks a verified TOTP time step used. Returns false for a replayed or older
-- step, so a code can never be used twice.
CREATE OR REPLACE FUNCTION staff_mfa_consume_step(p_user_id uuid, p_step bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users SET totp_last_step = p_step
  WHERE id = p_user_id AND (totp_last_step IS NULL OR totp_last_step < p_step);
  RETURN FOUND;
END;
$$;

-- migrate:split

DROP FUNCTION IF EXISTS staff_mfa_complete(uuid, uuid);

-- migrate:split

-- Completes enrollment for one organization after the caller verified a code
-- (against the pending secret, or the active one if the user is already
-- enrolled elsewhere) at time step p_step. Promotes the pending secret, marks
-- the step used, and requires MFA on this membership. The version triggers
-- revoke existing sessions, so the next sign-in must present a code.
CREATE FUNCTION staff_mfa_complete(p_user_id uuid, p_organization_id uuid, p_step bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users
  SET totp_secret = coalesce(totp_secret, totp_pending_secret),
      totp_pending_secret = NULL,
      totp_last_step = p_step,
      updated_at = now()
  WHERE id = p_user_id
    AND status = 'active' AND identity_deleted_at IS NULL
    AND (totp_secret IS NOT NULL OR totp_pending_secret IS NOT NULL)
    AND (totp_last_step IS NULL OR totp_last_step < p_step);
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE organization_memberships
  SET mfa_required = true, updated_at = now()
  WHERE platform_user_id = p_user_id
    AND organization_id = p_organization_id
    AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active membership not found.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO identity_audit_events (actor, action, organization_id, platform_user_id)
  VALUES ('self', 'mfa.enroll', p_organization_id, p_user_id);
  RETURN true;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION staff_mfa_disable(p_user_id uuid, p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organization_memberships
  SET mfa_required = false, updated_at = now()
  WHERE platform_user_id = p_user_id
    AND organization_id = p_organization_id
    AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active membership not found.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- The secret is per user: clear it only when no other membership needs it.
  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE platform_user_id = p_user_id AND status = 'active' AND mfa_required
  ) THEN
    UPDATE platform_users
    SET totp_secret = NULL, totp_pending_secret = NULL, updated_at = now()
    WHERE id = p_user_id;
  END IF;

  INSERT INTO identity_audit_events (actor, action, organization_id, platform_user_id)
  VALUES ('self', 'mfa.disable', p_organization_id, p_user_id);
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 7. Control-plane operator actions (replace provision_staff_member and the
--    FIELD_PROVISION_SECRET flow). Every action records its operator.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS provision_staff_member(text, text, text, uuid, text);

-- migrate:split

-- Adds (or re-activates) a staff member in ONE organization. Never changes the
-- global identity: an existing user's password, name and status are left
-- alone, and a globally suspended identity is refused (reactivating it is a
-- separate platform action). A user with no password yet receives an
-- 'initial' set-password token, whose hash the caller supplies.
CREATE OR REPLACE FUNCTION control_staff_provision(
  p_operator text,
  p_organization_id uuid,
  p_email text,
  p_display_name text,
  p_role text,
  p_initial_token_hash text,
  p_token_ttl_seconds integer
)
RETURNS TABLE (
  platform_user_id uuid,
  membership_id uuid,
  created_user boolean,
  initial_token_issued boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user platform_users%ROWTYPE;
  v_created boolean := false;
  v_membership uuid;
  v_token boolean := false;
BEGIN
  IF p_operator IS NULL OR char_length(p_operator) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'operator identity is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_role NOT IN ('owner', 'office', 'technician') THEN
    RAISE EXCEPTION 'invalid role' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organizations WHERE id = p_organization_id AND status IN ('active', 'provisioning')
  ) THEN
    RAISE EXCEPTION 'organization not found or not provisionable' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT * INTO v_user FROM platform_users WHERE email = lower(p_email) FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO platform_users (email, display_name, status)
    VALUES (lower(p_email), coalesce(nullif(btrim(p_display_name), ''), 'Staff member'), 'active')
    RETURNING * INTO v_user;
    v_created := true;
  ELSIF v_user.status <> 'active' OR v_user.identity_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'identity_inactive: reactivate the platform identity explicitly first'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO organization_memberships (organization_id, platform_user_id, clerk_membership_id, role, status, accepted_at)
  VALUES (p_organization_id, v_user.id, NULL, p_role, 'active', now())
  ON CONFLICT (organization_id, platform_user_id) DO UPDATE SET
    role = EXCLUDED.role,
    status = 'active',
    revoked_at = NULL,
    updated_at = now()
  RETURNING id INTO v_membership;

  IF v_user.password_hash IS NULL THEN
    IF p_initial_token_hash IS NULL THEN
      RAISE EXCEPTION 'an initial set-password token is required for a new identity'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE password_reset_tokens SET consumed_at = now()
    WHERE password_reset_tokens.platform_user_id = v_user.id AND consumed_at IS NULL;
    INSERT INTO password_reset_tokens (platform_user_id, organization_id, purpose, token_hash, issued_by, expires_at)
    VALUES (v_user.id, p_organization_id, 'initial', p_initial_token_hash, p_operator,
            now() + make_interval(secs => least(greatest(coalesce(p_token_ttl_seconds, 86400), 900), 604800)));
    v_token := true;
  END IF;

  INSERT INTO identity_audit_events (actor, action, organization_id, platform_user_id, detail)
  VALUES (p_operator, 'staff.provision', p_organization_id, v_user.id,
          jsonb_build_object('role', p_role, 'created_user', v_created, 'initial_token', v_token));

  platform_user_id := v_user.id;
  membership_id := v_membership;
  created_user := v_created;
  initial_token_issued := v_token;
  RETURN NEXT;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION control_staff_set_role(
  p_operator text,
  p_organization_id uuid,
  p_user_id uuid,
  p_role text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organization_memberships SET role = p_role, updated_at = now()
  WHERE organization_id = p_organization_id AND platform_user_id = p_user_id AND status = 'active';
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO identity_audit_events (actor, action, organization_id, platform_user_id, detail)
  VALUES (p_operator, 'staff.role', p_organization_id, p_user_id, jsonb_build_object('role', p_role));
  RETURN true;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION control_staff_revoke(
  p_operator text,
  p_organization_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organization_memberships SET status = 'revoked', revoked_at = now(), updated_at = now()
  WHERE organization_id = p_organization_id AND platform_user_id = p_user_id AND status = 'active';
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO identity_audit_events (actor, action, organization_id, platform_user_id)
  VALUES (p_operator, 'staff.revoke', p_organization_id, p_user_id);
  RETURN true;
END;
$$;

-- migrate:split

-- Global identity state: platform-level actions, never side effects of a
-- tenant's provisioning. A reason is mandatory and audited.
CREATE OR REPLACE FUNCTION control_identity_set_status(
  p_operator text,
  p_user_id uuid,
  p_status text,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'status must be active or suspended' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE platform_users SET status = p_status, updated_at = now()
  WHERE id = p_user_id AND identity_deleted_at IS NULL AND status IS DISTINCT FROM p_status;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO identity_audit_events (actor, action, platform_user_id, detail)
  VALUES (p_operator, 'identity.' || p_status, p_user_id, jsonb_build_object('reason', p_reason));
  RETURN true;
END;
$$;

-- migrate:split

-- Issues a single-use reset token. Scoped to an organization the user is an
-- active member of. The credential is global, so when the user ALSO belongs to
-- other organizations the operator must pass p_platform_authorized = true --
-- a tenant-scoped request can never silently reset another tenant's login.
CREATE OR REPLACE FUNCTION control_password_reset_issue(
  p_operator text,
  p_organization_id uuid,
  p_user_id uuid,
  p_token_hash text,
  p_ttl_seconds integer,
  p_platform_authorized boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = p_organization_id AND platform_user_id = p_user_id AND status = 'active'
  ) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE platform_user_id = p_user_id AND status = 'active' AND organization_id <> p_organization_id
  ) AND NOT coalesce(p_platform_authorized, false) THEN
    RAISE EXCEPTION 'cross_tenant_identity: this login also belongs to other organizations; platform authorization is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE password_reset_tokens SET consumed_at = now()
  WHERE platform_user_id = p_user_id AND consumed_at IS NULL;
  INSERT INTO password_reset_tokens (platform_user_id, organization_id, purpose, token_hash, issued_by, expires_at)
  VALUES (p_user_id, p_organization_id, 'reset', p_token_hash, p_operator,
          now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 3600), 900), 86400)));

  INSERT INTO identity_audit_events (actor, action, organization_id, platform_user_id, detail)
  VALUES (p_operator, 'password.reset_issued', p_organization_id, p_user_id,
          jsonb_build_object('platform_authorized', coalesce(p_platform_authorized, false)));
  RETURN true;
END;
$$;

-- migrate:split

-- Records an operator action that has no identity row of its own (tenant
-- provisioning, domain verification, activation).
CREATE OR REPLACE FUNCTION control_audit(
  p_operator text,
  p_action text,
  p_organization_id uuid,
  p_detail jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO identity_audit_events (actor, action, organization_id, detail)
  VALUES (p_operator, p_action, p_organization_id, coalesce(p_detail, '{}'::jsonb));
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 8. Grants (034 set default privileges: nothing here is PUBLIC)
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  staff_memberships_for_email(text),
  staff_session_issue(text, uuid, uuid, integer),
  staff_session_validate(text, uuid, uuid),
  staff_session_revoke(text),
  staff_login_lookup(text, uuid),
  staff_login_failure(text),
  staff_login_success(uuid),
  staff_password_rehash(uuid, text, text),
  staff_password_change(uuid, text, text),
  staff_password_reset_consume(text, text),
  staff_mfa_state(uuid),
  staff_mfa_initiate(uuid, text),
  staff_mfa_consume_step(uuid, bigint),
  staff_mfa_complete(uuid, uuid, bigint),
  staff_mfa_disable(uuid, uuid)
TO platform_runtime;

-- migrate:split

GRANT EXECUTE ON FUNCTION
  control_staff_provision(text, uuid, text, text, text, text, integer),
  control_staff_set_role(text, uuid, uuid, text),
  control_staff_revoke(text, uuid, uuid),
  control_identity_set_status(text, uuid, text, text),
  control_password_reset_issue(text, uuid, uuid, text, integer, boolean),
  control_audit(text, text, uuid, jsonb)
TO control_app;
