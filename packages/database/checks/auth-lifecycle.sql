-- auth-lifecycle.sql
--
-- P2 exit evidence: the native-auth lifecycle against a real database, through
-- the same SECURITY DEFINER windows the product (platform_runtime) and the
-- control plane (control_app) call.
--
--   1. operator provisioning is per-organization and never rewrites a global
--      identity; a new identity gets a single-use initial token
--   2. sessions are bound to user + membership versions
--   3. suspend -> reactivate cannot revive a token (user and membership)
--   4. role change forces re-login
--   5. password reset: single-use, expiring, revokes sessions; cross-tenant
--      reset needs platform authorization
--   6. MFA: pending secret, no overwrite of an active secret, replay refused
--   7. lockout after repeated failures, cleared by success
--   8. organization suspension revokes sessions
--   9. every mutation is audited with its actor
--
-- Runs as the owner inside one transaction that ROLLs BACK.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE control_app;
INSERT INTO organizations (id, slug, display_name, status) VALUES
  ('a1a1a1a1-0000-0000-0000-00000000000a', 'auth-alpha', 'Auth Alpha', 'active'),
  ('b2b2b2b2-0000-0000-0000-00000000000b', 'auth-beta',  'Auth Beta',  'active');
RESET ROLE;

CREATE TEMP TABLE t (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON t TO PUBLIC;

-- --------------------------------------------------------------------------
-- 1. Provisioning
-- --------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  r2 record;
  raised boolean := false;
BEGIN
  SET LOCAL ROLE control_app;
  SELECT * INTO r FROM control_staff_provision(
    'operator:alice', 'a1a1a1a1-0000-0000-0000-00000000000a', 'Pat@Example.test', 'Pat', 'owner',
    encode(sha256('initial-pat'::bytea), 'hex'), 86400);
  IF NOT r.created_user OR NOT r.initial_token_issued THEN
    RAISE EXCEPTION 'A new identity was not created with an initial token.';
  END IF;

  -- Same email provisioned into a second organization: a new membership with
  -- its own id; the identity is reused, not rewritten.
  SELECT * INTO r2 FROM control_staff_provision(
    'operator:bob', 'b2b2b2b2-0000-0000-0000-00000000000b', 'pat@example.test', 'Impostor Name', 'technician',
    encode(sha256('initial-pat-2'::bytea), 'hex'), 86400);
  RESET ROLE;

  IF r2.platform_user_id <> r.platform_user_id OR r2.created_user THEN
    RAISE EXCEPTION 'A second organization duplicated the identity.';
  END IF;
  IF r2.membership_id = r.membership_id THEN
    RAISE EXCEPTION 'Two organizations share one membership id.';
  END IF;
  IF (SELECT display_name FROM platform_users WHERE id = r.platform_user_id) <> 'Pat' THEN
    RAISE EXCEPTION 'Another organization''s provisioning rewrote the global display name.';
  END IF;
  IF EXISTS (SELECT 1 FROM organization_memberships WHERE platform_user_id = r.platform_user_id AND clerk_membership_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Native memberships still carry a shared external id.';
  END IF;

  INSERT INTO t VALUES ('user', r.platform_user_id::text), ('m_alpha', r.membership_id::text), ('m_beta', r2.membership_id::text);
END;
$$;

-- The initial token sets the password; it is single-use.
DO $$
DECLARE
  who uuid;
BEGIN
  SET LOCAL ROLE platform_runtime;
  who := staff_password_reset_consume(encode(sha256('initial-pat-2'::bytea), 'hex'), 'scrypt$16384$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA');
  IF who IS NULL THEN RAISE EXCEPTION 'The latest initial token did not set the password.'; END IF;
  IF staff_password_reset_consume(encode(sha256('initial-pat-2'::bytea), 'hex'), 'scrypt$x$again-and-again-and-again') IS NOT NULL THEN
    RAISE EXCEPTION 'An initial token was usable twice.';
  END IF;
  -- Issuing the second token superseded the first.
  IF staff_password_reset_consume(encode(sha256('initial-pat'::bytea), 'hex'), 'scrypt$x$superseded-token-value') IS NOT NULL THEN
    RAISE EXCEPTION 'A superseded initial token still worked.';
  END IF;
  RESET ROLE;
END;
$$;

-- A suspended identity is not silently reactivated by provisioning.
DO $$
DECLARE
  raised boolean := false;
BEGIN
  SET LOCAL ROLE control_app;
  PERFORM control_identity_set_status('operator:alice', (SELECT v FROM t WHERE k = 'user')::uuid, 'suspended', 'security review');
  BEGIN
    PERFORM * FROM control_staff_provision('operator:bob', 'b2b2b2b2-0000-0000-0000-00000000000b',
      'pat@example.test', 'Pat', 'owner', NULL, NULL);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'Tenant provisioning reactivated a globally suspended identity.';
  END IF;
  PERFORM control_identity_set_status('operator:alice', (SELECT v FROM t WHERE k = 'user')::uuid, 'active', 'review complete');
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 2-4. Version-bound sessions
-- --------------------------------------------------------------------------
DO $$
DECLARE
  u uuid := (SELECT v FROM t WHERE k = 'user')::uuid;
  alpha uuid := 'a1a1a1a1-0000-0000-0000-00000000000a';
  beta uuid := 'b2b2b2b2-0000-0000-0000-00000000000b';
  valid int;
BEGIN
  SET LOCAL ROLE platform_runtime;
  PERFORM * FROM staff_session_issue('jti-alpha-000000001', u, alpha, 3600);
  PERFORM * FROM staff_session_issue('jti-beta-0000000001', u, beta, 3600);
  SELECT count(*) INTO valid FROM staff_session_validate('jti-alpha-000000001', u, alpha);
  IF valid <> 1 THEN RAISE EXCEPTION 'A fresh session did not validate.'; END IF;
  -- A token for alpha cannot be used against beta.
  SELECT count(*) INTO valid FROM staff_session_validate('jti-alpha-000000001', u, beta);
  IF valid <> 0 THEN RAISE EXCEPTION 'A session validated for another organization.'; END IF;
  -- platform_runtime has no direct path to the session table any more.
  BEGIN
    PERFORM count(*) FROM field_sessions;
    RAISE EXCEPTION 'platform_runtime read field_sessions directly.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- Revoke then re-provision the alpha membership: the old alpha token must
  -- stay dead even though the membership is active again. Beta is untouched.
  SET LOCAL ROLE control_app;
  PERFORM control_staff_revoke('operator:alice', alpha, u);
  PERFORM * FROM control_staff_provision('operator:alice', alpha, 'pat@example.test', 'Pat', 'owner', NULL, NULL);
  RESET ROLE;

  SET LOCAL ROLE platform_runtime;
  SELECT count(*) INTO valid FROM staff_session_validate('jti-alpha-000000001', u, alpha);
  IF valid <> 0 THEN RAISE EXCEPTION 'A revoked-then-reactivated membership revived its old token.'; END IF;
  SELECT count(*) INTO valid FROM staff_session_validate('jti-beta-0000000001', u, beta);
  IF valid <> 1 THEN RAISE EXCEPTION 'Revoking one organization''s membership killed another''s session.'; END IF;

  -- Role change forces re-login (decision recorded in 035).
  PERFORM * FROM staff_session_issue('jti-alpha-000000002', u, alpha, 3600);
  RESET ROLE;
  SET LOCAL ROLE control_app;
  PERFORM control_staff_set_role('operator:alice', alpha, u, 'office');
  RESET ROLE;
  SET LOCAL ROLE platform_runtime;
  SELECT count(*) INTO valid FROM staff_session_validate('jti-alpha-000000002', u, alpha);
  IF valid <> 0 THEN RAISE EXCEPTION 'A role change left the old session valid.'; END IF;

  -- Global suspend -> reactivate: every session of the user stays dead.
  PERFORM * FROM staff_session_issue('jti-alpha-000000003', u, alpha, 3600);
  RESET ROLE;
  SET LOCAL ROLE control_app;
  PERFORM control_identity_set_status('operator:alice', u, 'suspended', 'suspected compromise');
  PERFORM control_identity_set_status('operator:alice', u, 'active', 'cleared after review');
  RESET ROLE;
  SET LOCAL ROLE platform_runtime;
  SELECT count(*) INTO valid FROM staff_session_validate('jti-alpha-000000003', u, alpha)
    UNION ALL SELECT count(*) FROM staff_session_validate('jti-beta-0000000001', u, beta)
    ORDER BY 1 DESC LIMIT 1;
  IF valid <> 0 THEN RAISE EXCEPTION 'A suspended-then-reactivated identity revived a token.'; END IF;

  -- Logout.
  PERFORM * FROM staff_session_issue('jti-alpha-000000004', u, alpha, 3600);
  PERFORM staff_session_revoke('jti-alpha-000000004');
  SELECT count(*) INTO valid FROM staff_session_validate('jti-alpha-000000004', u, alpha);
  IF valid <> 0 THEN RAISE EXCEPTION 'A logged-out session still validated.'; END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Password change / reset
-- --------------------------------------------------------------------------
DO $$
DECLARE
  u uuid := (SELECT v FROM t WHERE k = 'user')::uuid;
  alpha uuid := 'a1a1a1a1-0000-0000-0000-00000000000a';
  current_hash text;
  valid int;
  raised boolean := false;
BEGIN
  -- Tenant-scoped reset of a login that also belongs to beta needs platform
  -- authorization.
  SET LOCAL ROLE control_app;
  BEGIN
    PERFORM control_password_reset_issue('operator:alice', alpha, u, encode(sha256('reset-1'::bytea), 'hex'), 3600, false);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'A tenant-scoped reset rewrote a cross-tenant identity.'; END IF;
  PERFORM control_password_reset_issue('operator:alice', alpha, u, encode(sha256('reset-1'::bytea), 'hex'), 3600, true);
  RESET ROLE;

  SET LOCAL ROLE platform_runtime;
  PERFORM * FROM staff_session_issue('jti-alpha-000000005', u, alpha, 3600);
  IF staff_password_reset_consume(encode(sha256('reset-1'::bytea), 'hex'), 'scrypt$16384$8$1$bmV3c2FsdG5ld3NhbHQ$bmV3aGFzaG5ld2hhc2g') IS NULL THEN
    RAISE EXCEPTION 'A valid reset token was refused.';
  END IF;
  SELECT count(*) INTO valid FROM staff_session_validate('jti-alpha-000000005', u, alpha);
  IF valid <> 0 THEN RAISE EXCEPTION 'A password reset left existing sessions valid.'; END IF;

  -- Rehash keeps sessions; change (compare-and-set) revokes them.
  PERFORM * FROM staff_session_issue('jti-alpha-000000006', u, alpha, 3600);
  SELECT password_hash INTO current_hash FROM staff_login_lookup('pat@example.test', alpha);
  IF NOT staff_password_rehash(u, current_hash, 'scrypt$32768$8$1$cmVoYXNoc2FsdA$cmVoYXNoZWRoYXNoaGFzaA') THEN
    RAISE EXCEPTION 'Rehash compare-and-set failed.';
  END IF;
  SELECT count(*) INTO valid FROM staff_session_validate('jti-alpha-000000006', u, alpha);
  IF valid <> 1 THEN RAISE EXCEPTION 'A transparent rehash revoked sessions.'; END IF;
  IF staff_password_change(u, 'not-the-current-hash-value', 'scrypt$x$whatever-hash-value') THEN
    RAISE EXCEPTION 'A password change succeeded without the current hash.';
  END IF;
  IF NOT staff_password_change(u, 'scrypt$32768$8$1$cmVoYXNoc2FsdA$cmVoYXNoZWRoYXNoaGFzaA', 'scrypt$16384$8$1$Y2hhbmdlZHNhbHQ$Y2hhbmdlZGhhc2hoYXNo') THEN
    RAISE EXCEPTION 'A correct password change was refused.';
  END IF;
  SELECT count(*) INTO valid FROM staff_session_validate('jti-alpha-000000006', u, alpha);
  IF valid <> 0 THEN RAISE EXCEPTION 'A password change left sessions valid.'; END IF;
  RESET ROLE;

  -- Expired tokens are refused.
  INSERT INTO password_reset_tokens (platform_user_id, organization_id, purpose, token_hash, issued_by, created_at, expires_at)
  VALUES (u, alpha, 'reset', encode(sha256('expired'::bytea), 'hex'), 'operator:alice', now() - interval '2 hours', now() - interval '1 hour');
  SET LOCAL ROLE platform_runtime;
  IF staff_password_reset_consume(encode(sha256('expired'::bytea), 'hex'), 'scrypt$x$expired-token-value') IS NOT NULL THEN
    RAISE EXCEPTION 'An expired reset token worked.';
  END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. MFA
-- --------------------------------------------------------------------------
DO $$
DECLARE
  u uuid := (SELECT v FROM t WHERE k = 'user')::uuid;
  alpha uuid := 'a1a1a1a1-0000-0000-0000-00000000000a';
  beta uuid := 'b2b2b2b2-0000-0000-0000-00000000000b';
  st record;
  raised boolean := false;
  valid int;
BEGIN
  SET LOCAL ROLE platform_runtime;
  PERFORM staff_mfa_initiate(u, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  SELECT * INTO st FROM staff_mfa_state(u);
  IF st.totp_secret IS NOT NULL OR st.totp_pending_secret IS NULL THEN
    RAISE EXCEPTION 'Enrollment did not stage a pending secret.';
  END IF;

  PERFORM * FROM staff_session_issue('jti-alpha-000000007', u, alpha, 3600);
  IF NOT staff_mfa_complete(u, alpha, 1000) THEN RAISE EXCEPTION 'MFA completion failed.'; END IF;
  SELECT * INTO st FROM staff_mfa_state(u);
  IF st.totp_secret <> 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' OR st.totp_pending_secret IS NOT NULL THEN
    RAISE EXCEPTION 'Completion did not promote the pending secret.';
  END IF;
  SELECT count(*) INTO valid FROM staff_session_validate('jti-alpha-000000007', u, alpha);
  IF valid <> 0 THEN RAISE EXCEPTION 'Enabling MFA left a password-only session valid.'; END IF;
  IF NOT (SELECT mfa_required FROM staff_login_lookup('pat@example.test', alpha)) THEN
    RAISE EXCEPTION 'MFA completion did not require MFA on the membership.';
  END IF;

  -- A session in beta (no MFA) cannot replace the secret protecting alpha.
  BEGIN
    PERFORM staff_mfa_initiate(u, 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  EXCEPTION WHEN unique_violation THEN
    raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'An active TOTP secret was overwritten by a new enrollment.'; END IF;

  -- Replay: a step can be consumed once; older steps are refused.
  IF NOT staff_mfa_consume_step(u, 1001) THEN RAISE EXCEPTION 'A fresh TOTP step was refused.'; END IF;
  IF staff_mfa_consume_step(u, 1001) THEN RAISE EXCEPTION 'A TOTP step was accepted twice.'; END IF;
  IF staff_mfa_consume_step(u, 999) THEN RAISE EXCEPTION 'An older TOTP step was accepted.'; END IF;

  -- Beta can opt in with the existing authenticator (no new secret).
  IF NOT staff_mfa_complete(u, beta, 1002) THEN RAISE EXCEPTION 'Second-organization MFA opt-in failed.'; END IF;

  -- Disabling for alpha keeps the secret while beta still requires it.
  PERFORM staff_mfa_disable(u, alpha);
  SELECT * INTO st FROM staff_mfa_state(u);
  IF st.totp_secret IS NULL THEN RAISE EXCEPTION 'Disabling MFA in one org cleared the secret another org relies on.'; END IF;
  PERFORM staff_mfa_disable(u, beta);
  SELECT * INTO st FROM staff_mfa_state(u);
  IF st.totp_secret IS NOT NULL THEN RAISE EXCEPTION 'Disabling MFA everywhere left the secret behind.'; END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 7. Lockout
-- --------------------------------------------------------------------------
DO $$
DECLARE
  u uuid := (SELECT v FROM t WHERE k = 'user')::uuid;
  i int;
BEGIN
  SET LOCAL ROLE platform_runtime;
  FOR i IN 1..9 LOOP PERFORM staff_login_failure('pat@example.test'); END LOOP;
  IF (SELECT locked FROM staff_login_lookup('pat@example.test', 'a1a1a1a1-0000-0000-0000-00000000000a')) THEN
    RAISE EXCEPTION 'Locked before the threshold.';
  END IF;
  PERFORM staff_login_failure('PAT@example.test');
  IF NOT (SELECT locked FROM staff_login_lookup('pat@example.test', 'a1a1a1a1-0000-0000-0000-00000000000a')) THEN
    RAISE EXCEPTION 'Ten consecutive failures did not lock the account.';
  END IF;
  PERFORM staff_login_failure('nobody@example.test');  -- unknown email: no-op, no error
  PERFORM staff_login_success(u);
  IF (SELECT locked FROM staff_login_lookup('pat@example.test', 'a1a1a1a1-0000-0000-0000-00000000000a')) THEN
    RAISE EXCEPTION 'A successful login did not clear the lock.';
  END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 8. Organization suspension revokes its sessions
-- --------------------------------------------------------------------------
DO $$
DECLARE
  u uuid := (SELECT v FROM t WHERE k = 'user')::uuid;
  beta uuid := 'b2b2b2b2-0000-0000-0000-00000000000b';
  valid int;
BEGIN
  SET LOCAL ROLE platform_runtime;
  PERFORM * FROM staff_session_issue('jti-beta-0000000002', u, beta, 3600);
  RESET ROLE;
  UPDATE organizations SET status = 'suspended' WHERE id = beta;
  UPDATE organizations SET status = 'active' WHERE id = beta;
  SET LOCAL ROLE platform_runtime;
  SELECT count(*) INTO valid FROM staff_session_validate('jti-beta-0000000002', u, beta);
  IF valid <> 0 THEN RAISE EXCEPTION 'Suspending an organization left its sessions revivable.'; END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 9. Audit trail
-- --------------------------------------------------------------------------
DO $$
DECLARE
  actions text;
BEGIN
  SELECT string_agg(DISTINCT action, ',' ORDER BY action) INTO actions FROM identity_audit_events
  WHERE platform_user_id = (SELECT v FROM t WHERE k = 'user')::uuid;
  IF actions NOT LIKE '%staff.provision%' OR actions NOT LIKE '%staff.revoke%'
     OR actions NOT LIKE '%staff.role%' OR actions NOT LIKE '%identity.suspended%'
     OR actions NOT LIKE '%password.reset_issued%' OR actions NOT LIKE '%password.reset%'
     OR actions NOT LIKE '%password.change%' OR actions NOT LIKE '%mfa.enroll%'
     OR actions NOT LIKE '%mfa.disable%' OR actions NOT LIKE '%password.initial%' THEN
    RAISE EXCEPTION 'Identity audit trail is incomplete: %', actions;
  END IF;
  IF EXISTS (
    SELECT 1 FROM identity_audit_events
    WHERE platform_user_id = (SELECT v FROM t WHERE k = 'user')::uuid
      AND action LIKE 'staff.%' AND actor NOT IN ('operator:alice', 'operator:bob')
  ) THEN
    RAISE EXCEPTION 'Audit actor mismatch.';
  END IF;
  BEGIN
    UPDATE identity_audit_events SET actor = 'tampered';
    RAISE EXCEPTION 'The identity audit trail was mutable.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'The identity audit trail was mutable.' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;

\echo 'auth-lifecycle.sql: all checks passed'
