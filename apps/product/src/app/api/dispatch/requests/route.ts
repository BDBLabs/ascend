import type { NextRequest } from 'next/server';
import { platformDb, isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set(['electrical', 'plumbing', 'hvac', 'general']);

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Service temporarily unavailable' }, 503);
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

  if (!VALID_CATEGORIES.has(category)) {
    return privateJson({ error: 'Valid category is required (electrical, plumbing, hvac, general)' }, 400);
  }
  if (!workRequired || workRequired.length > 4000) {
    return privateJson({ error: 'workRequired is required (max 4000 chars)' }, 400);
  }
  if (siteLocation.length > 500) {
    return privateJson({ error: 'siteLocation must be at most 500 chars' }, 400);
  }

  try {
    const sql = platformDb();
    const rows = await sql.query(
      'SELECT create_dispatch_ticket($1, $2, $3) AS ticket',
      [category, workRequired, siteLocation],
    );

    const ticket = rows[0]?.ticket as { id: string; ticket_number: string } | undefined;
    if (!ticket) {
      return privateJson({ error: 'Failed to create dispatch ticket' }, 500);
    }

    return privateJson({ ok: true, ticketNumber: ticket.ticket_number }, 201);
  } catch (error) {
    console.error('Dispatch ticket creation failed:', error);
    return privateJson({ error: 'Failed to create dispatch ticket' }, 500);
  }
}
