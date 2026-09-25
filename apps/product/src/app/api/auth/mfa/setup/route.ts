import type { NextRequest } from 'next/server';
import { FIELD_SESSION_COOKIE, resolveStaffFromToken, initiateMfaEnrollment } from '@/lib/auth';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Initiates MFA enrollment for the authenticated user.
 * Returns a TOTP secret and otpauth:// URI for QR code generation.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(FIELD_SESSION_COOKIE)?.value ?? null;
  if (!token) return privateJson({ error: 'unauthenticated' }, 401);

  const staff = await resolveStaffFromToken(token);
  if (!staff) return privateJson({ error: 'unauthenticated' }, 401);

  if (staff.mfaRequired) {
    return privateJson({ error: 'already-enrolled' }, 400);
  }

  const result = await initiateMfaEnrollment(staff.platformUserId, staff.email);
  if (!result.ok) {
    // An authenticator is already active for this login (MFA in another
    // organization). It is never replaced here: confirm with a code from it
    // via POST /api/auth/mfa/enroll.
    return privateJson({ error: 'already-enrolled', next: 'confirm-existing-authenticator' }, 409);
  }

  return privateJson({ ok: true, secret: result.value.secret, uri: result.value.uri });
}