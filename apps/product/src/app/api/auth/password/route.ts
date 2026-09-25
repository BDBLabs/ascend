import type { NextRequest } from 'next/server';
import { changePassword, fieldSessionResponse, readFieldSessionToken, resolveStaffFromToken } from '@/lib/auth';
import { privateJson } from '@/lib/http';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimitWithFallback } from '@/lib/redis-rate-limit';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/password — authenticated password change.
 * Body: { currentPassword, newPassword }. Re-verifies the current password,
 * applies the password policy, and revokes every session (this one included);
 * the response clears the cookie so the user signs in again.
 */
export async function POST(request: NextRequest) {
  if (!publicRequestIsSameOrigin(request)) return privateJson({ error: 'forbidden' }, 403);
  const ip = getClientIp(request);
  if (!(await rateLimitWithFallback(`password-change:${ip}`, { capacity: 5, refillPerMinute: 2 }))) {
    return privateJson({ error: 'too-many-requests' }, 429);
  }

  const token = await readFieldSessionToken();
  const staff = token ? await resolveStaffFromToken(token) : null;
  if (!staff) return privateJson({ error: 'unauthenticated' }, 401);

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'invalid-body' }, 400);
  }
  if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
    return privateJson({ error: 'invalid-body' }, 400);
  }

  const result = await changePassword({
    email: staff.email,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });
  if (!result.ok) {
    if (result.reason === 'weak-password') return privateJson({ error: 'weak-password', detail: result.detail }, 400);
    if (result.reason === 'conflict') return privateJson({ error: 'conflict' }, 409);
    return privateJson({ error: 'invalid-credentials' }, 401);
  }
  return fieldSessionResponse({ ok: true, next: 'sign-in' }, null, 200);
}
