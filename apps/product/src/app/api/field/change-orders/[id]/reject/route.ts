import type { NextRequest } from 'next/server';
import { fieldPrincipalCan, getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { getClientIp } from '@/lib/rate-limit';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';
import { rejectChangeOrder } from '@/lib/change-orders';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.open')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Change orders unavailable' }, 503);
  }

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // reject with no body is ok
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > 500) {
    return privateJson({ error: 'Rejection reason is too long.' }, 400);
  }

  const ctx = {
    ip: getClientIp(request).slice(0, 128),
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
  };

  try {
    return await withFieldContext(principal, async () => {
      const result = await rejectChangeOrder(id, reason || 'No reason provided.', ctx);
      if (result.ok) return privateJson({ changeOrder: result.value });
      return privateJson({ error: result.reason }, 409);
    });
  } catch (error) {
    console.error('Change order reject failed.', error);
    return privateJson({ error: 'Change orders unavailable' }, 503);
  }
}
