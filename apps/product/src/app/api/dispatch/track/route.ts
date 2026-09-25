import type { NextRequest } from 'next/server';
import { db, isDatabaseConfigured } from '@/lib/db';
import { hashTrackingToken, isWellFormedTrackingToken } from '@/lib/dispatch-tracking';
import { privateJson } from '@/lib/http';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimitWithFallback } from '@/lib/redis-rate-limit';
import { TenantResolutionError, withTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

type LookupResult = {
  ok: boolean;
  error?: string;
  ticketNumber?: string;
  status?: string;
  activeStep?: number;
  category?: string;
  priority?: string;
  workSummary?: string;
  createdAt?: string;
};

/**
 * Public ticket progress, keyed by the tracking token issued at creation and
 * scoped to the tenant of the requesting host. Returns progress only -- never
 * the submitter's contact details (migration 033).
 */
export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Service temporarily unavailable' }, 503);
  }

  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (!token) {
    return privateJson({ error: 'token query parameter is required' }, 400);
  }

  const ip = getClientIp(request);
  if (!(await rateLimitWithFallback(`dispatch-track:${ip}`, { capacity: 30, refillPerMinute: 30 }))) {
    return privateJson({ error: 'Too many requests. Please try again later.' }, 429);
  }

  if (!isWellFormedTrackingToken(token)) {
    return privateJson({ ok: false, error: 'Ticket not found.' }, 404);
  }

  try {
    return await withTenant(async () => {
      const rows = await db().query(
        'SELECT lookup_dispatch_ticket($1) AS result',
        [hashTrackingToken(token)],
      );
      const result = rows[0]?.result as LookupResult | undefined;
      if (!result || !result.ok) {
        return privateJson({ ok: false, error: result?.error ?? 'Ticket not found.' }, 404);
      }
      return privateJson({
        ok: true,
        ticketNumber: result.ticketNumber,
        status: result.status,
        activeStep: result.activeStep,
        category: result.category,
        priority: result.priority,
        workSummary: result.workSummary,
        createdAt: result.createdAt,
      });
    });
  } catch (error) {
    if (error instanceof TenantResolutionError) {
      return privateJson({ ok: false, error: 'Ticket not found.' }, 404);
    }
    console.error('Dispatch ticket lookup failed:', error);
    return privateJson({ error: 'Failed to look up ticket' }, 500);
  }
}
