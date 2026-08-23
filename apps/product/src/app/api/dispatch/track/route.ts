import type { NextRequest } from 'next/server';
import { platformDb, isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Service temporarily unavailable' }, 503);
  }

  const ticket = request.nextUrl.searchParams.get('ticket');
  if (!ticket) {
    return privateJson({ error: 'ticket query parameter is required' }, 400);
  }

  try {
    const sql = platformDb();
    const rows = await sql.query(
      'SELECT lookup_dispatch_ticket($1) AS result',
      [ticket],
    );

    const result = rows[0]?.result as { ok: boolean; error?: string; ticketNumber?: string; status?: string; activeStep?: number; category?: string; createdAt?: string } | undefined;

    if (!result || !result.ok) {
      return privateJson({ ok: false, error: result?.error ?? 'Ticket not found.' }, 404);
    }

    return privateJson({
      ok: true,
      ticketNumber: result.ticketNumber,
      status: result.status,
      activeStep: result.activeStep,
      category: result.category,
      createdAt: result.createdAt,
    });
  } catch (error) {
    console.error('Dispatch ticket lookup failed:', error);
    return privateJson({ error: 'Failed to look up ticket' }, 500);
  }
}
