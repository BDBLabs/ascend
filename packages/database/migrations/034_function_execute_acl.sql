-- 034_function_execute_acl.sql
--
-- P1.1: the privileged-function boundary was not narrow. PostgreSQL grants
-- EXECUTE to PUBLIC on every new function, and no migration revoked it, so
-- every login -- including the NOINHERIT runtime/control logins before they
-- assume a role, and contractor_app for functions only platform_runtime should
-- reach -- could call every SECURITY DEFINER window (credential lookup, MFA
-- secret writes, staff provisioning, outbox claim/finish, billing sync).
--
-- This migration:
--   1. revokes EXECUTE on every function in schema public from PUBLIC and from
--      the three application roles;
--   2. re-grants exactly the matrix below, one role per call path;
--   3. sets owner default privileges so functions created by later migrations
--      start with no PUBLIC EXECUTE (each migration must grant explicitly).
--
-- The matrix is asserted, positively and negatively, by
-- packages/database/checks/function-acl.sql. Keep the two in step: a new
-- function needs a GRANT here (or in its own migration) AND a row there.
--
-- Trigger functions receive no grant: firing a trigger does not check EXECUTE.

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, contractor_app, control_app, platform_runtime', fn);
  END LOOP;
END;
$$;

-- migrate:split

-- Functions created from here on by the migration owner start closed.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- migrate:split

-- Tenant context: the transaction prelude runs after SET LOCAL ROLE, so the
-- assumed role (not the login) is what needs it.
GRANT EXECUTE ON FUNCTION set_application_context(uuid, uuid, uuid) TO contractor_app, control_app;

-- migrate:split

-- Policy helpers: evaluated inside RLS policies with the querying role's
-- privileges, so every role that reads a policed table needs them.
GRANT EXECUTE ON FUNCTION
  app_current_organization_id(),
  app_current_actor_id(),
  app_require_organization_id()
TO contractor_app, control_app, platform_runtime;

-- migrate:split

-- Tenant path (contractor_app, under an organization context).
GRANT EXECUTE ON FUNCTION
  allocate_document_number(text),
  create_job_snapshot(uuid, text, text, uuid, text, uuid),
  create_dispatch_ticket(text, text, text, text, text, text, text, text, timestamptz),
  lookup_dispatch_ticket(text)
TO contractor_app;

-- migrate:split

-- Hostname -> tenant resolution: the one window every role may use.
GRANT EXECUTE ON FUNCTION resolve_verified_organization(text)
TO contractor_app, control_app, platform_runtime;

-- migrate:split

-- Control plane.
GRANT EXECUTE ON FUNCTION link_organization_clerk(uuid, text) TO control_app;

-- migrate:split

-- Platform runtime: outbox drain and health.
GRANT EXECUTE ON FUNCTION
  claim_ready_outbox_messages(integer),
  finish_outbox_message(uuid, uuid, boolean, boolean, text),
  count_dead_outbox_messages(),
  outbox_health()
TO platform_runtime;

-- migrate:split

-- Platform runtime: native staff authentication windows.
GRANT EXECUTE ON FUNCTION
  staff_login_lookup(text, uuid),
  staff_memberships_for_email(text),
  staff_session_membership(uuid, uuid),
  staff_user_credential_lookup(text),
  staff_mfa_initiate(uuid, text),
  staff_mfa_complete(uuid, uuid),
  staff_mfa_disable(uuid, uuid),
  revoke_field_sessions_for_user(uuid),
  provision_staff_member(text, text, text, uuid, text)
TO platform_runtime;

-- migrate:split

-- Platform runtime: onboarding and billing webhooks.
GRANT EXECUTE ON FUNCTION
  create_organization_with_trade(text, text, text),
  link_stripe_customer(uuid, text),
  sync_stripe_subscription(text, text, text, text, timestamptz),
  resolve_organization_stripe_customer(uuid),
  resolve_organization_subscription(uuid)
TO platform_runtime;

-- Deliberately granted to NO application role (owner only) because no
-- application path calls them: the legacy Clerk windows
-- (upsert_platform_user, upsert_clerk_membership, revoke_clerk_membership,
-- deactivate_platform_user, resolve_organization_by_clerk_id,
-- suspend_organization_by_clerk_id) and the unused payment-idempotency
-- helpers (generate_payment_idempotency_key, validate_idempotency_key,
-- mark_idempotency_processing/completed/failed). Re-grant in a migration
-- when a caller is introduced.
