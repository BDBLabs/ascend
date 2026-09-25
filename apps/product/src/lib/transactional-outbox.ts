import 'server-only';

import { db, platformDb } from '@/lib/db';

export type OutboxMessage = {
  id: string;
  organizationId: string;
  topic: string;
  key: string;
  payload: Record<string, unknown>;
  attempts: number;
  /** Fencing token for this claim; finish must present it (migration 032). */
  claimToken: string;
};

export async function enqueueOutboxMessage(
  topic: string,
  key: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const sql = db();
  await sql.query(
    `INSERT INTO transactional_outbox (organization_id, topic, key, payload)
     SELECT app_require_organization_id(), $1, $2, $3::jsonb`,
    [topic, key, JSON.stringify(payload)],
  );
}

/**
 * Claims ready messages through the SECURITY DEFINER window. Runs on the
 * platform client: the drain is a cross-tenant job and platform_runtime has no
 * direct read of the outbox — only the claim window.
 */
export async function claimOutboxMessages(batchSize: number): Promise<OutboxMessage[]> {
  const rows = (await platformDb().query('SELECT * FROM claim_ready_outbox_messages($1)', [
    batchSize,
  ])) as Array<{
    id: string;
    organization_id: string;
    topic: string;
    key: string;
    payload: Record<string, unknown>;
    attempts: number;
    claim_token: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    topic: row.topic,
    key: row.key,
    payload: row.payload,
    attempts: Number(row.attempts),
    claimToken: row.claim_token,
  }));
}

export type OutboxOutcome =
  | { succeeded: true }
  | { succeeded: false; retryable: boolean; error: string };

/**
 * Records a claimed message's outcome. Returns false when the claim token no
 * longer owns the row -- the lease expired and another worker re-claimed it,
 * or the outcome was already recorded. That is the fence working, not a fault:
 * the caller must not retry with a different token.
 */
export async function finishOutboxMessage(
  message: Pick<OutboxMessage, 'id' | 'claimToken'>,
  outcome: OutboxOutcome,
): Promise<boolean> {
  const rows = (await platformDb().query(
    'SELECT finish_outbox_message($1, $2, $3, $4, $5) AS recorded',
    [
      message.id,
      message.claimToken,
      outcome.succeeded,
      outcome.succeeded ? true : outcome.retryable,
      outcome.succeeded ? null : outcome.error,
    ],
  )) as Array<{ recorded: boolean }>;
  return rows[0]?.recorded === true;
}

export type OutboxHealth = {
  pending: number;
  oldestPendingSeconds: number;
  claimed: number;
  expiredLeases: number;
  dead: number;
};

/** Backlog/lease/dead counts for the health probe and alerting (no tenant data). */
export async function readOutboxHealth(): Promise<OutboxHealth> {
  const rows = (await platformDb().query('SELECT * FROM outbox_health()', [])) as Array<{
    pending: string | number;
    oldest_pending_seconds: string | number;
    claimed: string | number;
    expired_leases: string | number;
    dead: string | number;
  }>;
  const row = rows[0];
  return {
    pending: Number(row?.pending ?? 0),
    oldestPendingSeconds: Number(row?.oldest_pending_seconds ?? 0),
    claimed: Number(row?.claimed ?? 0),
    expiredLeases: Number(row?.expired_leases ?? 0),
    dead: Number(row?.dead ?? 0),
  };
}
