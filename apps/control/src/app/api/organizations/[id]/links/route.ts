import { authorizeControl } from '@/lib/control-auth';
import { revokeCustomerLinks } from '@/lib/control-operations';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/organizations/[id]/links — revoke customer document links.
 *   { "reason": "...", "documentId"?: "<uuid>" }
 * Without documentId every active link of the tenant is revoked (incident
 * response). Audited with the operator id; see docs/RUNBOOKS.md.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = authorizeControl(request);
  if ('response' in auth) return auth.response;
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ ok: false, error: 'organization id must be a uuid' }, { status: 400 });

  let body: { reason?: unknown; documentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'request body must be JSON' }, { status: 400 });
  }
  const documentId = typeof body.documentId === 'string' ? body.documentId : null;
  if (documentId !== null && !UUID_PATTERN.test(documentId)) {
    return Response.json({ ok: false, error: 'documentId must be a uuid' }, { status: 400 });
  }
  if (typeof body.reason !== 'string' || body.reason.trim().length < 5) {
    return Response.json({ ok: false, error: 'a reason (5+ characters) is required' }, { status: 400 });
  }

  try {
    const revoked = await revokeCustomerLinks(auth.caller.id, id, documentId, body.reason.trim().slice(0, 500));
    return Response.json({ ok: true, revoked });
  } catch {
    return Response.json({ ok: false, error: 'revocation failed' }, { status: 500 });
  }
}
