import type { NextRequest } from 'next/server';
import { fieldPrincipalCan, getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { getChangeOrder, getChangeOrderLines } from '@/lib/change-orders';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Change orders unavailable' }, 503);
  }

  const { id } = await params;

  try {
    return await withFieldContext(principal, async () => {
      const order = await getChangeOrder(id);
      if (!order) return privateJson({ error: 'Not found' }, 404);
      const lines = await getChangeOrderLines(id);
      return privateJson({ changeOrder: order, lines });
    });
  } catch (error) {
    console.error('Change order detail failed.', error);
    return privateJson({ error: 'Change orders unavailable' }, 503);
  }
}
