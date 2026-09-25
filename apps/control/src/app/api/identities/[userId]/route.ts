import { authorizeControl } from '@/lib/control-auth';
import { setIdentityStatus, StaffActionError } from '@/lib/control-staff';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/identities/[userId] — PLATFORM-level identity status.
 *   { "status": "suspended" | "active", "reason": "..." }
 * Affects the login in every organization, so it is a separate, explicit,
 * audited action (never a side effect of one tenant's staff provisioning).
 * Suspension revokes every session; reactivation revives none of them.
 */
export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  const auth = authorizeControl(request);
  if ('response' in auth) return auth.response;

  const { userId } = await context.params;
  if (!UUID_PATTERN.test(userId)) {
    return Response.json({ ok: false, error: 'userId must be a uuid' }, { status: 400 });
  }
  let body: { status?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'request body must be JSON' }, { status: 400 });
  }

  try {
    const result = await setIdentityStatus(auth.caller.id, userId, body.status, body.reason);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof StaffActionError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    return Response.json({ ok: false, error: 'identity action failed' }, { status: 500 });
  }
}
