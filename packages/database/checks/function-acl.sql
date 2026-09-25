-- function-acl.sql
--
-- P1.1 exit evidence: the function EXECUTE matrix, asserted positively and
-- negatively for every application role and every function in schema public.
--
--   - No function in public is executable by PUBLIC.
--   - Each application role can execute exactly the functions in its row of the
--     expected matrix below -- no more (negative) and no fewer (positive).
--   - The login roles, when present (ascend_runtime, ascend_control), hold no
--     direct EXECUTE: they are NOINHERIT and must assume a role first.
--   - Owner default privileges: a function created now starts with no PUBLIC
--     EXECUTE.
--
-- Read-only apart from one throwaway function created and rolled back. Safe to
-- run against production as the owner (the created function never commits),
-- though the normal target is a disposable branch like every other suite.

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE expected_acl (role_name text, signature text) ON COMMIT DROP;

INSERT INTO expected_acl (role_name, signature) VALUES
  -- context + policy helpers
  ('contractor_app', 'set_application_context(uuid,uuid,uuid)'),
  ('control_app',    'set_application_context(uuid,uuid,uuid)'),
  ('contractor_app', 'app_current_organization_id()'),
  ('control_app',    'app_current_organization_id()'),
  ('platform_runtime','app_current_organization_id()'),
  ('contractor_app', 'app_current_actor_id()'),
  ('control_app',    'app_current_actor_id()'),
  ('platform_runtime','app_current_actor_id()'),
  ('contractor_app', 'app_require_organization_id()'),
  ('control_app',    'app_require_organization_id()'),
  ('platform_runtime','app_require_organization_id()'),
  -- tenant path
  ('contractor_app', 'allocate_document_number(text)'),
  ('contractor_app', 'create_job_snapshot(uuid,text,text,uuid,text,uuid)'),
  ('contractor_app', 'create_dispatch_ticket(text,text,text,text,text,text,text,text,timestamp with time zone)'),
  ('contractor_app', 'lookup_dispatch_ticket(text)'),
  ('contractor_app', 'tenant_domain_add(text,text)'),
  ('contractor_app', 'create_estimate_delivery(uuid,uuid,timestamp with time zone,text,text,uuid,uuid,text,uuid,text,text,timestamp with time zone,uuid,jsonb)'),
  ('contractor_app', 'tenant_domain_challenge(uuid)'),
  ('contractor_app', 'tenant_domain_mark_verified(uuid,text)'),
  ('contractor_app', 'tenant_domain_remove(uuid)'),
  -- hostname resolution
  ('contractor_app', 'resolve_verified_organization(text)'),
  ('control_app',    'resolve_verified_organization(text)'),
  ('platform_runtime','resolve_verified_organization(text)'),
  -- control plane
  ('control_app',    'link_organization_clerk(uuid,text)'),
  -- platform runtime
  ('platform_runtime','claim_ready_outbox_messages(integer)'),
  ('platform_runtime','finish_outbox_message(uuid,uuid,boolean,boolean,text)'),
  ('platform_runtime','count_dead_outbox_messages()'),
  ('platform_runtime','outbox_health()'),
  ('platform_runtime','staff_login_lookup(text,uuid)'),
  ('platform_runtime','staff_memberships_for_email(text)'),
  ('platform_runtime','staff_user_credential_lookup(text)'),
  ('platform_runtime','staff_mfa_initiate(uuid,text)'),
  ('platform_runtime','staff_mfa_disable(uuid,uuid)'),
  ('platform_runtime','revoke_field_sessions_for_user(uuid)'),
  -- native auth lifecycle (035)
  ('platform_runtime','staff_session_issue(text,uuid,uuid,integer)'),
  ('platform_runtime','staff_session_validate(text,uuid,uuid)'),
  ('platform_runtime','staff_session_revoke(text)'),
  ('platform_runtime','staff_login_failure(text)'),
  ('platform_runtime','staff_login_success(uuid)'),
  ('platform_runtime','staff_password_rehash(uuid,text,text)'),
  ('platform_runtime','staff_password_change(uuid,text,text)'),
  ('platform_runtime','staff_password_reset_consume(text,text)'),
  ('platform_runtime','staff_mfa_state(uuid)'),
  ('platform_runtime','staff_mfa_consume_step(uuid,bigint)'),
  ('platform_runtime','staff_mfa_complete(uuid,uuid,bigint)'),
  -- control-plane operator actions (035)
  ('control_app',    'control_staff_provision(text,uuid,text,text,text,text,integer)'),
  ('control_app',    'control_staff_set_role(text,uuid,uuid,text)'),
  ('control_app',    'control_staff_revoke(text,uuid,uuid)'),
  ('control_app',    'control_identity_set_status(text,uuid,text,text)'),
  ('control_app',    'control_password_reset_issue(text,uuid,uuid,text,integer,boolean)'),
  ('control_app',    'control_audit(text,text,uuid,jsonb)'),
  ('platform_runtime','link_stripe_customer(uuid,text)'),
  ('platform_runtime','sync_stripe_subscription(text,text,text,text,timestamp with time zone)'),
  ('platform_runtime','resolve_organization_stripe_customer(uuid)'),
  ('platform_runtime','resolve_organization_subscription(uuid)');

-- Functions and their normalized signatures (types only, no argument names).
CREATE TEMP TABLE public_functions ON COMMIT DROP AS
SELECT p.oid,
       p.proname || '(' || coalesce(
         (SELECT string_agg(format_type(t, NULL), ',' ORDER BY ord)
            FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS a(t, ord)),
         '') || ')' AS signature,
       p.proacl
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p');

-- Every expected signature must exist, or the matrix has drifted from the
-- schema (a rename would otherwise pass silently).
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(DISTINCT e.signature, ', ') INTO missing
  FROM expected_acl AS e
  WHERE NOT EXISTS (SELECT 1 FROM public_functions AS f WHERE f.signature = e.signature);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'function-acl: expected functions do not exist: %', missing;
  END IF;
END;
$$;

-- No PUBLIC EXECUTE anywhere. A NULL proacl means "default privileges", which
-- for functions includes PUBLIC EXECUTE.
DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(f.signature, ', ' ORDER BY f.signature) INTO offenders
  FROM public_functions AS f
  WHERE f.proacl IS NULL
     OR EXISTS (
       SELECT 1 FROM aclexplode(f.proacl) AS acl
       WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     );
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'function-acl: PUBLIC can execute: %', offenders;
  END IF;
END;
$$;

-- Positive and negative matrix, per role, via has_function_privilege.
DO $$
DECLARE
  app_role text;
  unexpected text;
  denied text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['contractor_app', 'control_app', 'platform_runtime'] LOOP
    SELECT string_agg(f.signature, ', ' ORDER BY f.signature) INTO unexpected
    FROM public_functions AS f
    WHERE has_function_privilege(app_role, f.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM expected_acl AS e
        WHERE e.role_name = app_role AND e.signature = f.signature
      );
    IF unexpected IS NOT NULL THEN
      RAISE EXCEPTION 'function-acl: % can execute functions outside its matrix: %', app_role, unexpected;
    END IF;

    SELECT string_agg(f.signature, ', ' ORDER BY f.signature) INTO denied
    FROM public_functions AS f
    JOIN expected_acl AS e ON e.signature = f.signature AND e.role_name = app_role
    WHERE NOT has_function_privilege(app_role, f.oid, 'EXECUTE');
    IF denied IS NOT NULL THEN
      RAISE EXCEPTION 'function-acl: % is missing EXECUTE it needs: %', app_role, denied;
    END IF;
  END LOOP;
END;
$$;

-- Login roles hold nothing directly (NOINHERIT; privileges arrive only by
-- SET LOCAL ROLE). Skipped for a login that does not exist on this branch.
DO $$
DECLARE
  login text;
  reachable text;
BEGIN
  FOREACH login IN ARRAY ARRAY['ascend_runtime', 'ascend_control'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = login) THEN
      SELECT string_agg(f.signature, ', ' ORDER BY f.signature) INTO reachable
      FROM public_functions AS f
      WHERE has_function_privilege(login, f.oid, 'EXECUTE');
      IF reachable IS NOT NULL THEN
        RAISE EXCEPTION 'function-acl: login % can execute without assuming a role: %', login, reachable;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- Default privileges: a function created by the owner now starts closed.
CREATE FUNCTION function_acl_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1';

DO $$
BEGIN
  IF has_function_privilege('contractor_app', 'function_acl_probe()', 'EXECUTE')
     OR has_function_privilege('platform_runtime', 'function_acl_probe()', 'EXECUTE')
     OR has_function_privilege('control_app', 'function_acl_probe()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'function-acl: a newly created function is executable by PUBLIC (default privileges not secured).';
  END IF;
END;
$$;

ROLLBACK;

\echo 'function-acl.sql: all checks passed'
