import { authorizeControl } from '@/lib/control-auth';
import {
  issuePasswordReset,
  provisionStaff,
  revokeStaff,
  setStaffRole,
  StaffActionError,
} from '@/lib/control-staff';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(message: string) {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/**
 * POST /api/organizations/[id]/staff — operator staff actions for ONE tenant.
 *   { "action": "provision", "email", "displayName", "role" }
 *       -> { setPasswordToken } when the identity has no password yet
 *   { "action": "set-role", "userId", "role" }        (forces re-login)
 *   { "action": "revoke", "userId" }
 *   { "action": "reset-password", "userId", "platformAuthorized"? }
 *       -> { resetToken } (1 hour, single use). A login that also belongs to
 *          other organizations needs "platformAuthorized": true.
 *
 * Operator identity required; every action is audited with the operator id.
 * Tokens are returned once for out-of-band delivery and stored only as hashes.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = authorizeControl(request);
  if ('response' in auth) return auth.response;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return badRequest('organization id must be a uuid');

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return badRequest('request body must be JSON');
  }
  const userId = typeof body.userId === 'string' ? body.userId : '';

  try {
    switch (body.action) {
      case 'provision': {
        const result = await provisionStaff({
          actor: auth.caller.id,
          organizationId: id,
          email: body.email,
          displayName: body.displayName,
          role: body.role,
        });
        return Response.json({ ok: true, ...result }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
      }
      case 'set-role':
        if (!UUID_PATTERN.test(userId)) return badRequest('userId must be a uuid');
        await setStaffRole(auth.caller.id, id, userId, body.role);
        return Response.json({ ok: true });
      case 'revoke':
        if (!UUID_PATTERN.test(userId)) return badRequest('userId must be a uuid');
        await revokeStaff(auth.caller.id, id, userId);
        return Response.json({ ok: true });
      case 'reset-password': {
        if (!UUID_PATTERN.test(userId)) return badRequest('userId must be a uuid');
        const result = await issuePasswordReset(auth.caller.id, id, userId, body.platformAuthorized === true);
        return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
      }
      default:
        return badRequest('action must be provision, set-role, revoke or reset-password');
    }
  } catch (error) {
    if (error instanceof StaffActionError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    return Response.json({ ok: false, error: 'staff action failed' }, { status: 500 });
  }
}
