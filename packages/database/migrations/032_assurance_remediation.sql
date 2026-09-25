-- 032_assurance_remediation.sql
--
-- Closes defects that the SQL check suites catch on a freshly migrated branch
-- (docs/assurance/REMEDIATION_PLAN.md). Each section is independent.
--
-- 1. FORCE ROW LEVEL SECURITY on ai_conversations / ai_messages. Migration 022
--    enabled RLS but never forced it, so the table owner (and every SECURITY
--    DEFINER function it owns) bypassed the tenant policy there.
--
-- 2. Invoice terminal-state trigger. Migration 017 replaced the 004 trigger
--    and silently dropped the issued -> issued freeze, so an issued invoice's
--    title, money columns and content hash could be edited. It also overwrote
--    the content hash with the draft's value at issue time, required timestamps
--    the application never sets (issue/cancel/pay all failed their CHECKs), and
--    lost the integrity_constraint_violation SQLSTATE callers rely on. The
--    replacement restores the 004 contract and adds partially_paid.
--
-- 3. Outbox claim/finish contract (P3.3):
--    - expired leases are reclaimed; a lease that expires on the final attempt
--      is moved to 'dead' instead of being stranded in 'claimed';
--    - each claim issues a fresh claim_token, returned with the attempt count;
--      finish must present it, so a slow worker whose lease was reclaimed can
--      no longer overwrite the new owner's outcome (fencing);
--    - finish distinguishes retryable from terminal errors;
--    - the claim is fair across tenants: it takes the oldest ready message of
--      every tenant before the second-oldest of any.
--    - outbox_health() exposes backlog, oldest-pending age, expired leases and
--      dead rows for the health probe and alerting.

-- ---------------------------------------------------------------------------
-- 1. Force RLS on AI conversation tables
-- ---------------------------------------------------------------------------

ALTER TABLE ai_conversations FORCE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE ai_messages FORCE ROW LEVEL SECURITY;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 2. Invoice terminal-state immutability
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_invoice_terminal_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION
      'Invoice % is % and cannot be modified.', OLD.display_id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'An invoice cannot return to draft.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status = 'issued' AND NEW.status NOT IN ('issued', 'partially_paid', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'Unsupported invoice transition % -> %.', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status = 'partially_paid' AND NEW.status NOT IN ('partially_paid', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'Unsupported invoice transition % -> %.', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Once issued, the document a customer was asked to pay is frozen. Only the
  -- status, payment progress and lifecycle timestamps may move.
  IF OLD.status IN ('issued', 'partially_paid')
     AND (
       NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.job_id IS DISTINCT FROM OLD.job_id
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.due_at IS DISTINCT FROM OLD.due_at
       OR NEW.discount_millipercent IS DISTINCT FROM OLD.discount_millipercent
       OR NEW.surcharge_cents IS DISTINCT FROM OLD.surcharge_cents
       OR NEW.tax_rate_millipercent IS DISTINCT FROM OLD.tax_rate_millipercent
       OR NEW.deposit_cents IS DISTINCT FROM OLD.deposit_cents
       OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
       OR NEW.taxable_subtotal_cents IS DISTINCT FROM OLD.taxable_subtotal_cents
       OR NEW.discount_cents IS DISTINCT FROM OLD.discount_cents
       OR NEW.taxable_after_discount_cents IS DISTINCT FROM OLD.taxable_after_discount_cents
       OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
       OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
       OR NEW.money_version IS DISTINCT FROM OLD.money_version
       OR NEW.document_template_version IS DISTINCT FROM OLD.document_template_version
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     )
  THEN
    RAISE EXCEPTION
      'Invoice % is issued and its content is frozen.', OLD.display_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status IN ('issued', 'partially_paid') AND NEW.amount_paid_cents < OLD.amount_paid_cents THEN
    RAISE EXCEPTION 'Recorded payments on invoice % cannot decrease.', OLD.display_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status = 'partially_paid'
     AND (NEW.amount_paid_cents <= 0 OR NEW.amount_paid_cents >= NEW.total_cents)
  THEN
    RAISE EXCEPTION 'A partially paid invoice must have 0 < paid < total.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lifecycle timestamps are stamped here so every caller agrees with the
  -- table CHECKs (status <> 'issued' OR issued_at IS NOT NULL, and so on).
  IF NEW.status = 'issued' AND OLD.status = 'draft' THEN
    NEW.issued_at := coalesce(NEW.issued_at, now());
  END IF;
  IF NEW.status = 'paid' THEN
    NEW.amount_paid_cents := NEW.total_cents;
    NEW.paid_at := coalesce(NEW.paid_at, now());
  END IF;
  IF NEW.status = 'cancelled' THEN
    NEW.cancelled_at := coalesce(NEW.cancelled_at, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 3. Outbox: fenced, fair, recoverable claim/finish
-- ---------------------------------------------------------------------------

ALTER TABLE transactional_outbox
  ADD COLUMN IF NOT EXISTS claim_token uuid;

-- migrate:split

-- Claims taken under the old contract carry no token and could never be
-- finished under the new one. Return them to the retry queue.
UPDATE transactional_outbox
SET status = 'failed', claimed_until = NULL, last_error = 'reclaimed_by_032', updated_at = now()
WHERE status = 'claimed';

-- migrate:split

ALTER TABLE transactional_outbox
  ADD CONSTRAINT transactional_outbox_claim_token_check
    CHECK ((status = 'claimed') = (claim_token IS NOT NULL));

-- migrate:split

CREATE INDEX IF NOT EXISTS transactional_outbox_lease_idx
  ON transactional_outbox (claimed_until, id)
  WHERE status = 'claimed';

-- migrate:split

DROP FUNCTION IF EXISTS claim_ready_outbox_messages(integer);

-- migrate:split

DROP FUNCTION IF EXISTS finish_outbox_message(uuid, boolean, text);

-- migrate:split

CREATE FUNCTION claim_ready_outbox_messages(batch_size integer)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  topic text,
  key text,
  payload jsonb,
  attempts integer,
  claim_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 200 THEN
    RAISE EXCEPTION 'batch_size must be between 1 and 200.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- A lease that expired on the final permitted attempt can never be claimed
  -- again; record it as dead rather than leaving it 'claimed' forever.
  UPDATE transactional_outbox AS outbox
  SET status = 'dead',
      claimed_until = NULL,
      claim_token = NULL,
      last_error = 'lease_expired',
      updated_at = now()
  WHERE outbox.status = 'claimed'
    AND outbox.claimed_until <= now()
    AND outbox.attempts >= 12;

  RETURN QUERY
  WITH ready AS (
    SELECT outbox.id, outbox.next_attempt_at,
           row_number() OVER (
             PARTITION BY outbox.organization_id
             ORDER BY outbox.next_attempt_at, outbox.id
           ) AS tenant_rank
    FROM transactional_outbox AS outbox
    WHERE (
        outbox.status IN ('pending', 'failed')
        OR (outbox.status = 'claimed' AND outbox.claimed_until <= now())
      )
      AND outbox.next_attempt_at <= now()
      AND outbox.attempts < 12
  ),
  ordered AS (
    SELECT ready.id, ready.tenant_rank, ready.next_attempt_at
    FROM ready
    WHERE ready.tenant_rank <= batch_size
  ),
  locked AS (
    SELECT outbox.id, ordered.tenant_rank, ordered.next_attempt_at
    FROM transactional_outbox AS outbox
    JOIN ordered ON ordered.id = outbox.id
    -- Re-check under the row lock: another worker may have claimed it between
    -- the snapshot above and the lock.
    WHERE (
        outbox.status IN ('pending', 'failed')
        OR (outbox.status = 'claimed' AND outbox.claimed_until <= now())
      )
    ORDER BY ordered.tenant_rank, ordered.next_attempt_at, outbox.id
    LIMIT batch_size
    FOR UPDATE OF outbox SKIP LOCKED
  )
  UPDATE transactional_outbox AS outbox
  SET
    status = 'claimed',
    attempts = outbox.attempts + 1,
    claimed_until = now() + interval '5 minutes',
    claim_token = gen_random_uuid(),
    updated_at = now()
  FROM locked
  WHERE outbox.id = locked.id
  RETURNING outbox.id, outbox.organization_id, outbox.topic, outbox.key,
            outbox.payload, outbox.attempts, outbox.claim_token;
END;
$$;

-- migrate:split

-- Returns true when the outcome was recorded; false when the claim was no
-- longer held by this token (lease reclaimed by another worker, or already
-- finished). A false return is not an error: it is the fence working.
CREATE FUNCTION finish_outbox_message(
  target_id uuid,
  p_claim_token uuid,
  succeeded boolean,
  retryable boolean,
  error_text text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'A claim token is required to finish an outbox message.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF succeeded THEN
    UPDATE transactional_outbox
    SET status = 'sent', sent_at = now(), claimed_until = NULL, claim_token = NULL,
        last_error = NULL, updated_at = now()
    WHERE id = target_id AND status = 'claimed' AND claim_token = p_claim_token;
  ELSE
    UPDATE transactional_outbox
    SET
      status = CASE WHEN NOT coalesce(retryable, false) OR attempts >= 12 THEN 'dead' ELSE 'failed' END,
      next_attempt_at = now() + (least(attempts, 10) * interval '60 seconds'),
      last_error = left(coalesce(error_text, ''), 500),
      claimed_until = NULL,
      claim_token = NULL,
      updated_at = now()
    WHERE id = target_id AND status = 'claimed' AND claim_token = p_claim_token;
  END IF;

  RETURN FOUND;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION outbox_health()
RETURNS TABLE (
  pending bigint,
  oldest_pending_seconds bigint,
  claimed bigint,
  expired_leases bigint,
  dead bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*) FILTER (WHERE status IN ('pending', 'failed')),
    coalesce(extract(epoch FROM now() - min(created_at) FILTER (WHERE status IN ('pending', 'failed')))::bigint, 0),
    count(*) FILTER (WHERE status = 'claimed'),
    count(*) FILTER (WHERE status = 'claimed' AND claimed_until <= now()),
    count(*) FILTER (WHERE status = 'dead')
  FROM transactional_outbox;
$$;
