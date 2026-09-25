import { authorizeControl } from '@/lib/control-auth';
import { listOrganizations, provisionTenant } from '@/lib/control-plane';

export const dynamic = 'force-dynamic';

/**
 * POST /api/organizations — provision a new tenant. The request body is the
 * onboarding contract (slug, hostname, config, optional price book); the tenant
 * is created atomically and returned in 'provisioning' state, ready for DNS
 * verification and activation.
 */
export async function POST(request: Request) {
  const auth = authorizeControl(request, { allowService: true });
  if ('response' in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  try {
    const tenant = await provisionTenant(body, auth.caller.id);
    return Response.json(
      { ok: true, tenant, next: 'verify DNS then activate' },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return Response.json(
      { ok: false, error: message },
      { status: message.startsWith('slug ') || message.startsWith('hostname ') ? 409 : 400 },
    );
  }
}

/**
 * GET /api/organizations — every organization on the platform, newest first.
 */
export async function GET(request: Request) {
  const auth = authorizeControl(request);
  if ('response' in auth) return auth.response;

  try {
    const organizations = await listOrganizations();
    return Response.json({ ok: true, organizations });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'unknown error' },
      { status: 500 },
    );
  }
}
