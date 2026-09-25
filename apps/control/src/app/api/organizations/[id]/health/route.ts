import { authorizeControl } from '@/lib/control-auth';
import { tenantHealth } from '@/lib/control-operations';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/organizations/[id]/health — per-tenant health for operators:
 * lifecycle, domains, configuration, staff/MFA coverage, outbox backlog and
 * dead rows, and the last successful sign-in, delivery and signature.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = authorizeControl(request);
  if ('response' in auth) return auth.response;
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ ok: false, error: 'organization id must be a uuid' }, { status: 400 });
  try {
    const health = await tenantHealth(id);
    if (!health) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    return Response.json({ ok: true, health }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'health unavailable' }, { status: 500 });
  }
}
