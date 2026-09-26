-- function-acls.sql
--
-- Proves the P1.1 privilege lockdown (migration 032) against a live database.
-- Runs as the migration owner. Every assertion raises on failure, so a clean
-- exit is the pass condition. Ends with ROLLBACK: read-only suite, safe to
-- re-run, but point it at a disposable branch per verify.mjs, never production.

\set ON_ERROR_STOP on

BEGIN;

-- --------------------------------------------------------------------------
-- 1. No application function is executable by PUBLIC.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  leaking text;
BEGIN
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    INTO leaking
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND has_function_privilege('public', p.oid, 'execute');
  IF leaking IS NOT NULL THEN
    RAISE EXCEPTION 'Functions still executable by PUBLIC: %', leaking;
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Tenant-context primitives: all three app roles.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app_current_organization_id()',
    'app_current_actor_id()',
    'app_require_organization_id()',
    'set_application_context(uuid, uuid, uuid)',
    'resolve_verified_organization(text)',
    'allocate_document_number(text)'
  ] LOOP
    IF NOT has_function_privilege('contractor_app', f, 'execute') THEN
      RAISE EXCEPTION 'contractor_app cannot execute %', f;
    END IF;
    IF NOT has_function_privilege('platform_runtime', f, 'execute') THEN
      RAISE EXCEPTION 'platform_runtime cannot execute %', f;
    END IF;
    IF NOT has_function_privilege('control_app', f, 'execute') THEN
      RAISE EXCEPTION 'control_app cannot execute %', f;
    END IF;
  END LOOP;
END;
$$;

-- --------------------------------------------------------------------------
-- 3. Service/operator functions: platform_runtime + control_app, and NOT
--    the tenant role (least privilege across the tenant boundary).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'claim_ready_outbox_messages(integer)',
    'finish_outbox_message(uuid, boolean, text)',
    'staff_login_lookup(text, uuid)',
    'staff_memberships_for_email(text)',
    'revoke_field_sessions_for_user(uuid)',
    'provision_staff_member(text, text, text, uuid, text)',
    'staff_user_credential_lookup(text)',
    'staff_mfa_initiate(uuid, text)',
    'staff_mfa_complete(uuid, uuid)',
    'staff_mfa_disable(uuid, uuid)',
    'upsert_platform_user(text, text, text, boolean)',
    'deactivate_platform_user(text)',
    'link_organization_clerk(uuid, text)',
    'resolve_organization_by_clerk_id(text)',
    'suspend_organization_by_clerk_id(text)',
    'upsert_clerk_membership(text, text, text, text, text, text, boolean)',
    'revoke_clerk_membership(text)',
    'sync_stripe_subscription(text, text, text, text, timestamptz)',
    'link_stripe_customer(uuid, text)',
    'count_dead_outbox_messages()',
    'resolve_organization_subscription(uuid)',
    'resolve_organization_stripe_customer(uuid)',
    'generate_payment_idempotency_key(text, uuid, bigint)',
    'validate_idempotency_key(text, text, uuid, bigint, uuid, text)',
    'mark_idempotency_processing(uuid)',
    'mark_idempotency_completed(uuid, text, text)',
    'mark_idempotency_failed(uuid, text)',
    'create_organization_with_trade(text, text, text)',
    'create_dispatch_ticket(text, text, text)',
    'create_dispatch_ticket(text, text, text, text, text, text, text, timestamptz)',
    'lookup_dispatch_ticket(text)'
  ] LOOP
    IF NOT has_function_privilege('platform_runtime', f, 'execute') THEN
      RAISE EXCEPTION 'platform_runtime cannot execute %', f;
    END IF;
    IF NOT has_function_privilege('control_app', f, 'execute') THEN
      RAISE EXCEPTION 'control_app cannot execute %', f;
    END IF;
    IF has_function_privilege('contractor_app', f, 'execute') THEN
      RAISE EXCEPTION 'contractor_app can execute service function % (tenant-boundary leak)', f;
    END IF;
  END LOOP;
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Job snapshots: tenant role only (unchanged from 016).
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT has_function_privilege(
    'contractor_app', 'create_job_snapshot(uuid, text, text, uuid, text, uuid)', 'execute'
  ) THEN
    RAISE EXCEPTION 'contractor_app cannot execute create_job_snapshot';
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Trigger helpers are not directly executable by any app role.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'enforce_estimate_terminal_state()',
    'enforce_estimate_lines_locked()',
    'reject_mutation()',
    'enforce_price_book_release_terminal()',
    'enforce_price_book_release_items_draft()',
    'enforce_configuration_terminal()',
    'enforce_line_item_price_source()',
    'enforce_invoice_terminal_state()',
    'enforce_invoice_lines_locked()',
    'reject_change_order_mutation()',
    'restrict_posted_cost_mutation()'
  ] LOOP
    IF has_function_privilege('contractor_app', f, 'execute') THEN
      RAISE EXCEPTION 'contractor_app can execute trigger helper %', f;
    END IF;
    IF has_function_privilege('platform_runtime', f, 'execute') THEN
      RAISE EXCEPTION 'platform_runtime can execute trigger helper %', f;
    END IF;
    IF has_function_privilege('control_app', f, 'execute') THEN
      RAISE EXCEPTION 'control_app can execute trigger helper %', f;
    END IF;
  END LOOP;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. Secure defaults hold: a newly created function grants nothing to PUBLIC.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION p11_probe_function() RETURNS integer
LANGUAGE sql AS $$ SELECT 1 $$;

DO $$
BEGIN
  IF has_function_privilege('public', 'p11_probe_function()', 'execute') THEN
    RAISE EXCEPTION 'New functions still default to PUBLIC execute (ALTER DEFAULT PRIVILEGES missing)';
  END IF;
  IF has_function_privilege('contractor_app', 'p11_probe_function()', 'execute') THEN
    RAISE EXCEPTION 'Probe function unexpectedly executable by contractor_app';
  END IF;
END;
$$;

DROP FUNCTION p11_probe_function();

ROLLBACK;

\echo 'function-acls.sql: all checks passed'
