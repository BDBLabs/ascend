import { LATEST_MIGRATION } from '@contractor-platform/database';
import { isDatabaseConfigured, platformDb } from '@/lib/db';
import { readOutboxHealth } from '@/lib/transactional-outbox';

export const dynamic = 'force-dynamic';

/**
 * Bounded readiness only. Deliberately exposes no tenant identifiers, counts,
 * or customer data — a health endpoint is unauthenticated by nature, so
 * anything it returns is public.
 *
 * Uses platformDb() because a health probe arrives with no tenant.
 * LATEST_MIGRATION is imported from @contractor-platform/database so both apps
 * always agree on the expected schema version without hand-rolling the string.
 *
 * Outbox signals (counts only, never tenant-attributed) for alerting:
 *   deadOutboxMessages      > 0      deliveries were lost; investigate.
 *   outboxExpiredLeases     > 0      a worker crashed mid-claim; the next drain
 *                                    reclaims it, persistent non-zero = no drain.
 *   outboxOldestPendingSeconds       backlog age; alert above the delivery SLO
 *                                    (OUTBOX_PENDING_SLO_SECONDS, default 900).
 *   outboxWithinSlo                  false when the oldest pending message is
 *                                    older than the SLO, i.e. the cron is missed
 *                                    or failing.
 *
 * `?probe=live` is a liveness probe: it answers 200 without touching the
 * database, so a slow or unavailable database does not get a healthy process
 * restarted. The default (readiness) requires the database and latest schema.
 */
export async function GET(request?: Request) {
  const probe = request ? new URL(request.url).searchParams.get('probe') : null;
  if (probe === 'live') {
    return Response.json(
      { ok: true, service: 'product', probe: 'live' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const checks: Record<string, boolean | number> = { database: false, schema: false };

  if (isDatabaseConfigured()) {
    try {
      const rows = await platformDb().query(
        `SELECT
           COUNT(*) AS applied_count,
           EXISTS (SELECT 1 FROM _migrations WHERE name = $1) AS latest_applied
         FROM _migrations`,
        [LATEST_MIGRATION],
      );
      checks.database = true;
      checks.schema = Boolean(rows[0]?.latest_applied);
      checks.migrationCount = Number(rows[0]?.applied_count ?? 0);
    } catch {
      // Leave all false; the status code carries the signal.
    }

    // Outbox signals are observable metrics, deliberately separate from the
    // readiness gate: a backlog does not stop the service serving requests.
    if (checks.database) {
      try {
        const outbox = await readOutboxHealth();
        const slo = Number(process.env.OUTBOX_PENDING_SLO_SECONDS ?? 900);
        checks.deadOutboxMessages = outbox.dead;
        checks.outboxPending = outbox.pending;
        checks.outboxOldestPendingSeconds = outbox.oldestPendingSeconds;
        checks.outboxExpiredLeases = outbox.expiredLeases;
        checks.outboxWithinSlo = outbox.oldestPendingSeconds <= slo;
      } catch {
        // outbox_health is migration 032; the schema check above already
        // reports an older schema, so skip rather than fail readiness.
      }
    }
  }

  const ok = checks.database && checks.schema;
  return Response.json(
    { ok, service: 'product', checks, latestMigration: LATEST_MIGRATION },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
