import type { NextRequest } from 'next/server';
import { decideCustomerEstimate } from '@/lib/customer-estimate-decision';
import { isDatabaseConfigured } from '@/lib/db';
import { customerAccessTokensConfigured } from '@/lib/customer-access-tokens';
import { privateJson, readJsonBody, RequestBodyTooLargeError } from '@/lib/http';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';
import { TenantResolutionError, withTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 2048;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Document response unavailable.' }, 503);
  }
  if (!customerAccessTokensConfigured()) {
    return privateJson({ error: 'Document response unavailable.' }, 503);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
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

  const { token } = await params;
  const clientIp = getClientIp(request);
  if (!rateLimit(`document_decision:${token}:${clientIp}`, { capacity: 10 })) {
    return privateJson({ error: 'Please wait before trying again.' }, 429);
  }

  const record = body as Record<string, unknown>;
  const decision = record.decision === 'approved' || record.decision === 'declined'
    ? record.decision
    : null;
  if (!decision) return privateJson({ error: 'Invalid decision.' }, 400);

  return withTenant(async () => {
    try {
      const result = await decideCustomerEstimate(token, {
        decision,
        signerName: typeof record.signerName === 'string' ? record.signerName : '',
        affirmativeConsent: record.affirmativeConsent === true,
        ip: clientIp.slice(0, 128),
        userAgent: request.headers.get('user-agent'),
      });
      if (result.ok) return privateJson(result);

      const status = result.reason === 'invalid'
        ? 400
        : result.reason === 'not-found'
          ? 404
          : result.reason === 'expired'
            ? 410
            : 409;
      const message = result.reason === 'expired'
        ? 'This link has expired.'
        : result.reason === 'already-decided'
          ? 'This estimate already has a customer response.'
          : result.reason === 'invalid'
            ? 'The response is incomplete.'
            : 'This response could not be recorded.';
      return privateJson({ error: message, reason: result.reason }, status);
    } catch {
      console.error('Customer estimate decision failed.');
      return privateJson({ error: 'Document response unavailable.' }, 503);
    }
  }).catch((error: unknown) => {
    if (error instanceof TenantResolutionError) {
      return privateJson({ error: 'Not found' }, 404);
    }
    throw error;
  });
}
