import type { NextRequest } from 'next/server';
import { fieldPrincipalCan, getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { getClientIp } from '@/lib/rate-limit';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';
import { cancelInvoice } from '@/lib/invoices';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'invoices.open')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Invoices unavailable' }, 503);
  }

  const { id } = await params;

  const ctx = {
    ip: getClientIp(request).slice(0, 128),
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
  };

  try {
    return await withFieldContext(principal, async () => {
      const result = await cancelInvoice(id, ctx);
      if (result.ok) return privateJson({ invoice: result.value });
      if (result.reason === 'not-found') return privateJson({ error: 'Not found' }, 404);
      return privateJson({ error: 'Invoice is already in a terminal state.' }, 409);
    });
  } catch (error) {
    console.error('Invoice cancel failed.', error);
    return privateJson({ error: 'Invoices unavailable' }, 503);
  }
}
