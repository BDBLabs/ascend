import type { NextRequest } from 'next/server';
import { platformDb, isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set(['electrical', 'plumbing', 'hvac', 'general']);
const VALID_PRIORITIES = new Set(['emergency', 'urgent', 'normal', 'low']);

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

  try {
    const sql = platformDb();
    const rows = await sql.query(
      'SELECT create_dispatch_ticket($1, $2, $3, $4, $5, $6, $7, $8) AS ticket',
      [category, workRequired, siteLocation, contactName, contactEmail, contactPhone, priority, preferredDate],
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
