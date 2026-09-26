-- Migration 032: function privilege lockdown (P1.1).
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default, so every
-- application function below was callable by any login — including the
-- trigger helpers and the SECURITY DEFINER windows, whose only protection
-- was obscurity. This migration:
--
--   1. Revokes the default PUBLIC execute on every existing application
--      function in schema public (blanket form, so overloads such as the
--      two create_dispatch_ticket signatures are covered with no
--      signature list to rot). pg_catalog built-ins (e.g. gen_random_uuid)
--      live outside schema public and are unaffected.
--   2. Closes the default for the future: functions created by the migration
--      owner no longer grant EXECUTE to PUBLIC. Every new function must
--      carry its own explicit GRANT in the migration that creates it.
--   3. Restates the complete explicit grant matrix (idempotent GRANTs, so
--      re-running the statements is safe). Trigger-only helpers
--      (enforce_*, reject_*, restrict_*) get no grant: trigger firing
--      performs no EXECUTE privilege check, and no application path calls
--      them directly.
--
-- Notable corrections vs. the pre-032 state:
--   - set_application_context(uuid, uuid, uuid) was granted TO PUBLIC with a
--     comment claiming the runtime login calls it before switching role.
--     Current callers (product db.ts, control control-db.ts) issue
--     SET LOCAL ROLE first and call it as the app role, so the PUBLIC grant
--     is replaced by grants to the three app roles.
--   - The 023 eight-argument create_dispatch_ticket overload and the 017
--     idempotency helpers had no explicit grant and ran on the PUBLIC
--     default. The dispatch overload joins platform_runtime (public-portal
--     API calls it via platformDb); the idempotency helpers join
--     platform_runtime + control_app, mirroring the outbox/stripe service
--     functions (no current direct callers; tenant paths use direct SQL).

-- 1. Strip the PUBLIC default on everything already here.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- migrate:split

-- 2. Secure default for functions created from here on.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- migrate:split

-- 3a. Tenant-context and identity primitives: every app role.
GRANT EXECUTE ON FUNCTION
  app_current_organization_id(),
  app_current_actor_id(),
  app_require_organization_id(),
  set_application_context(uuid, uuid, uuid),
  resolve_verified_organization(text),
  allocate_document_number(text)
  TO contractor_app, platform_runtime, control_app;

-- migrate:split

-- 3b. Clerk identity sync and outbox (005): service + operator roles.
GRANT EXECUTE ON FUNCTION
  upsert_platform_user(text, text, text, boolean),
  deactivate_platform_user(text),
  link_organization_clerk(uuid, text),
  resolve_organization_by_clerk_id(text),
  suspend_organization_by_clerk_id(text),
  upsert_clerk_membership(text, text, text, text, text, text, boolean),
  revoke_clerk_membership(text),
  claim_ready_outbox_messages(integer),
  finish_outbox_message(uuid, boolean, text)
  TO platform_runtime, control_app;

-- migrate:split

-- 3c. Native field auth (007/009): service + operator roles.
GRANT EXECUTE ON FUNCTION
  staff_login_lookup(text, uuid),
  staff_session_membership(uuid, uuid),
  revoke_field_sessions_for_user(uuid),
  staff_memberships_for_email(text),
  provision_staff_member(text, text, text, uuid, text)
  TO platform_runtime, control_app;

-- migrate:split

-- 3d. Stripe billing (013) and observability (014): service + operator roles.
GRANT EXECUTE ON FUNCTION
  sync_stripe_subscription(text, text, text, text, timestamptz),
  link_stripe_customer(uuid, text),
  count_dead_outbox_messages(),
  resolve_organization_subscription(uuid)
  TO platform_runtime, control_app;

-- migrate:split

-- 3e. Outbox reclaim, credential lookup, MFA windows, stripe-customer
-- resolution (015): service + operator roles.
GRANT EXECUTE ON FUNCTION
  staff_user_credential_lookup(text),
  staff_mfa_initiate(uuid, text),
  staff_mfa_complete(uuid, uuid),
  staff_mfa_disable(uuid, uuid),
  resolve_organization_stripe_customer(uuid)
  TO platform_runtime, control_app;

-- migrate:split

-- 3f. Job snapshots (016): tenant role (unchanged from 016).
GRANT EXECUTE ON FUNCTION
  create_job_snapshot(uuid, text, text, uuid, text, uuid)
  TO contractor_app;

-- migrate:split

-- 3g. Payment idempotency helpers (017): service + operator roles (see header).
GRANT EXECUTE ON FUNCTION
  generate_payment_idempotency_key(text, uuid, bigint),
  validate_idempotency_key(text, text, uuid, bigint, uuid, text),
  mark_idempotency_processing(uuid),
  mark_idempotency_completed(uuid, text, text),
  mark_idempotency_failed(uuid, text)
  TO platform_runtime, control_app;

-- migrate:split

-- 3h. Workspace provisioning (018) and dispatch portal (021/023, both
-- overloads): platform runtime (public-portal API calls via platformDb).
GRANT EXECUTE ON FUNCTION
  create_organization_with_trade(text, text, text),
  create_dispatch_ticket(text, text, text),
  create_dispatch_ticket(text, text, text, text, text, text, text, timestamptz),
  lookup_dispatch_ticket(text)
  TO platform_runtime;
