import type { NextRequest } from 'next/server';
import { db, isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/field/domains/[id] — remove a custom domain.
 * Cannot remove the canonical domain.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'organization.configure')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Domains unavailable' }, 503);
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return privateJson({ error: 'Invalid domain id' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      // Tenant-scoped window: only this organization's non-canonical domains.
      const rows = await db().query('SELECT tenant_domain_remove($1::uuid) AS removed', [id]);
      if (!rows[0]?.removed) {
        return privateJson({ error: 'Domain not found or not removable' }, 404);
      }
      return privateJson({ ok: true });
    });
  } catch (error) {
    console.error('Domain delete failed.', error);
    return privateJson({ error: 'Domain delete failed' }, 500);
  }
}
