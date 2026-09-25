import { authorizeControl } from '@/lib/control-auth';
import { listAuditEvents } from '@/lib/control-staff';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/audit[?organizationId=&limit=] — the append-only operator and
 * identity audit trail (identity_audit_events), newest first.
 */
export async function GET(request: Request) {
  const auth = authorizeControl(request);
  if ('response' in auth) return auth.response;

  const params = new URL(request.url).searchParams;
  const organizationId = params.get('organizationId') ?? undefined;
  if (organizationId && !UUID_PATTERN.test(organizationId)) {
    return Response.json({ ok: false, error: 'organizationId must be a uuid' }, { status: 400 });
  }
  const limit = Number(params.get('limit') ?? 100);

  try {
    const events = await listAuditEvents({ organizationId, limit: Number.isFinite(limit) ? limit : 100 });
    return Response.json({ ok: true, events }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'audit unavailable' }, { status: 500 });
  }
}
