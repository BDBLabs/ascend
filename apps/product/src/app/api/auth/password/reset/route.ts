import type { NextRequest } from 'next/server';
import { fieldSessionResponse, resetPasswordWithToken } from '@/lib/auth';
import { privateJson } from '@/lib/http';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimitWithFallback } from '@/lib/redis-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/password/reset — consume an operator-issued reset or initial
 * set-password token. Body: { token, newPassword }.
 *
 * Recovery model (P2.3): there is no self-service "forgot password" email
 * while outbound email is held (P0.2). A control-plane operator issues a
 * single-use, expiring token (audited; cross-tenant identities need explicit
 * platform authorization) and delivers the link out of band. Consuming it sets
 * the password and revokes every session. Unknown, used and expired tokens are
 * indistinguishable.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!(await rateLimitWithFallback(`password-reset:${ip}`, { capacity: 5, refillPerMinute: 1 }))) {
    return privateJson({ error: 'too-many-requests' }, 429);
  }

  let body: { token?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'invalid-body' }, 400);
  }
  if (typeof body.token !== 'string' || typeof body.newPassword !== 'string') {
    return privateJson({ error: 'invalid-body' }, 400);
  }

  const result = await resetPasswordWithToken({ token: body.token, newPassword: body.newPassword });
  if (!result.ok) {
    if (result.reason === 'weak-password') return privateJson({ error: 'weak-password', detail: result.detail }, 400);
    return privateJson({ error: 'invalid-token' }, 400);
  }
  return fieldSessionResponse({ ok: true, next: 'sign-in' }, null, 200);
}
