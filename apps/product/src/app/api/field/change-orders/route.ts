import type { NextRequest } from 'next/server';
import { fieldPrincipalCan, getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson, readJsonBody, RequestBodyTooLargeError } from '@/lib/http';
import { UUID_PATTERN } from '@/lib/ids';
import { getClientIp } from '@/lib/rate-limit';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';
import { createChangeOrder } from '@/lib/change-orders';
import { validateChangeOrderInput } from '@/lib/change-order-contract';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8192;

export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.prepare')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Change orders unavailable' }, 503);
  }

  let body: unknown;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return privateJson({ error: 'Bad Request' }, 400);
    }
    return privateJson({ error: 'Invalid body' }, 400);
  }

  if (typeof body !== 'object' || body === null) {
    return privateJson({ error: 'Body must be an object.' }, 400);
  }
  const record = body as Record<string, unknown>;
  if (typeof record.estimateId !== 'string' || !UUID_PATTERN.test(record.estimateId)) {
    return privateJson({ error: 'Invalid estimateId' }, 400);
  }

  const validation = validateChangeOrderInput(record);
  if (!validation.ok) {
    return privateJson({ error: validation.error }, 400);
  }

  const ctx = {
    ip: getClientIp(request).slice(0, 128),
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
  };

  try {
    return await withFieldContext(principal, async () => {
      const result = await createChangeOrder(record.estimateId as string, validation.value, ctx);
      if (result.ok) return privateJson({ changeOrder: result.value }, 201);
      const messages = {
        'estimate-not-found': 'Estimate not found.',
        'estimate-not-signed': 'Only a signed estimate can have change orders.',
        'job-required': 'Link the estimate to a job first.',
        'job-not-found': 'Job not found.',
        'job-cancelled': 'Cancelled jobs cannot accept change orders.',
        'validation-error': result.detail ?? 'Validation error.',
      } as const;
      return privateJson({ error: messages[result.reason] }, 409);
    });
  } catch (error) {
    console.error('Change order create failed.', error);
    return privateJson({ error: 'Change orders unavailable' }, 503);
  }
}
