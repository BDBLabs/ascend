import type { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { db, isDatabaseConfigured } from '@/lib/db';
import { generateTrackingToken, hashTrackingToken } from '@/lib/dispatch-tracking';
import { classifyHost } from '@/lib/host';
import { privateJson } from '@/lib/http';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimitWithFallback } from '@/lib/redis-rate-limit';
import { TenantResolutionError, withTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set(['electrical', 'plumbing', 'hvac', 'general']);
const VALID_PRIORITIES = new Set(['emergency', 'urgent', 'normal', 'low']);

/**
 * Public dispatch intake. A ticket belongs to the tenant whose verified
 * hostname received it (migration 033): it is written through the tenant
 * path under RLS, never through a platform-wide window. The response carries
 * the one-time tracking token; only its hash is stored.
 */
export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Service temporarily unavailable' }, 503);
  }

  // Fast host gate before reading the body: only tenant hosts take intake.
  const host = (await headers()).get('host') ?? '';
  if (classifyHost(host) !== 'tenant') {
    return privateJson({ error: 'Dispatch is not available on this host.' }, 404);
  }

  const ip = getClientIp(request);
  if (!(await rateLimitWithFallback(`dispatch:${ip}`, { capacity: 10, refillPerMinute: 3 }))) {
    return privateJson({ error: 'Too many requests. Please try again later.' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return privateJson({ error: 'Invalid JSON body' }, 400);
  }

  const category = typeof body.category === 'string' ? body.category : '';
  const workRequired = typeof body.workRequired === 'string' ? body.workRequired.trim() : '';
  const siteLocation = typeof body.siteLocation === 'string' ? body.siteLocation : '';
  const contactName = typeof body.contactName === 'string' ? body.contactName.trim() : '';
  const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '';
  const contactPhone = typeof body.contactPhone === 'string' ? body.contactPhone.trim() : '';
  const priority = typeof body.priority === 'string' ? body.priority : 'normal';
  const preferredDate = typeof body.preferredDate === 'string' ? body.preferredDate : null;

  if (!VALID_CATEGORIES.has(category)) {
    return privateJson({ error: 'Valid category is required (electrical, plumbing, hvac, general)' }, 400);
  }
  if (!workRequired || workRequired.length > 4000) {
    return privateJson({ error: 'workRequired is required (max 4000 chars)' }, 400);
  }
  if (siteLocation.length > 500) {
    return privateJson({ error: 'siteLocation must be at most 500 chars' }, 400);
  }
  if (contactName.length > 200) {
    return privateJson({ error: 'contactName must be at most 200 chars' }, 400);
  }
  if (contactEmail.length > 320) {
    return privateJson({ error: 'contactEmail must be at most 320 chars' }, 400);
  }
  if (contactPhone.length > 40) {
    return privateJson({ error: 'contactPhone must be at most 40 chars' }, 400);
  }
  if (!VALID_PRIORITIES.has(priority)) {
    return privateJson({ error: 'Invalid priority (emergency, urgent, normal, low)' }, 400);
  }

  const trackingToken = generateTrackingToken();

  try {
    return await withTenant(async () => {
      const rows = await db().query(
        'SELECT id, ticket_number FROM create_dispatch_ticket($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          hashTrackingToken(trackingToken),
          category, workRequired, siteLocation, contactName, contactEmail,
          contactPhone, priority, preferredDate,
        ],
      );

      const ticket = rows[0] as { id: string; ticket_number: string } | undefined;
      if (!ticket) {
        return privateJson({ error: 'Failed to create dispatch ticket' }, 500);
      }

      return privateJson({ ok: true, ticketNumber: ticket.ticket_number, trackingToken }, 201);
    });
  } catch (error) {
    if (error instanceof TenantResolutionError) {
      return privateJson({ error: 'Dispatch is not available on this host.' }, 404);
    }
    console.error('Dispatch ticket creation failed:', error);
    return privateJson({ error: 'Failed to create dispatch ticket' }, 500);
  }
}
