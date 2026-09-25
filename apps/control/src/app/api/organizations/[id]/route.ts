import { authorizeControl } from '@/lib/control-auth';
import {
  activateOrganization,
  getOrganizationReadiness,
  verifyCanonicalDomain,
} from '@/lib/control-plane';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(message: string) {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/**
 * GET /api/organizations/[id] — provisioning readiness for one tenant.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = authorizeControl(request);
  if ('response' in auth) return auth.response;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return badRequest('organization id must be a uuid');

  try {
    const readiness = await getOrganizationReadiness(id);
    if (!readiness) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    return Response.json({ ok: true, readiness });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/organizations/[id] — lifecycle steps on a provisioning tenant.
 *   { "action": "verify-domain" }  mark the canonical hostname DNS-verified
 *   { "action": "activate" }       gate-check, then make the tenant active
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = authorizeControl(request);
  if ('response' in auth) return auth.response;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return badRequest('organization id must be a uuid');

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest('request body must be JSON');
  }

  if (body.action !== 'verify-domain' && body.action !== 'activate') {
    return badRequest('action must be "verify-domain" or "activate"');
  }

  try {
    if (body.action === 'verify-domain') {
      await verifyCanonicalDomain(id, auth.caller.id);
    } else {
      await activateOrganization(id, auth.caller.id);
    }
    const readiness = await getOrganizationReadiness(id);
    return Response.json({ ok: true, action: body.action, readiness });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 409 });
  }
}
