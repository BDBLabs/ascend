import type { NextRequest } from 'next/server';
import { fieldPrincipalCan, getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson, readJsonBody, RequestBodyTooLargeError } from '@/lib/http';
import { getClientIp } from '@/lib/rate-limit';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';
import { issueInvoice } from '@/lib/invoices';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

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

  let body: unknown;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return privateJson({ error: 'Bad Request' }, 400);
    }
    return privateJson({ error: 'Invalid body' }, 400);
  }
  const record = body as Record<string, unknown>;

  if (typeof record.expectedUpdatedAt !== 'string' || record.expectedUpdatedAt.length === 0) {
    return privateJson({ error: 'expectedUpdatedAt is required.' }, 400);
  }

  const ctx = {
    ip: getClientIp(request).slice(0, 128),
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
  };

  try {
    return await withFieldContext(principal, async () => {
      const result = await issueInvoice(id, record.expectedUpdatedAt as string, ctx);
      if (result.ok) return privateJson({ invoice: result.value });
      if (result.reason === 'not-found') return privateJson({ error: 'Not found' }, 404);
      if (result.reason === 'not-draft') return privateJson({ error: 'Invoice is not in draft status.' }, 409);
      return privateJson({ error: 'Invoice changed since you loaded it. Reload and try again.', retryable: true }, 409);
    });
  } catch (error) {
    console.error('Invoice issue failed.', error);
    return privateJson({ error: 'Invoices unavailable' }, 503);
  }
}
