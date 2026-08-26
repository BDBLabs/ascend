import type { NextRequest } from 'next/server';
import { fieldPrincipalCan, getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { getInvoice, getInvoiceLines } from '@/lib/invoices';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'invoices.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Invoices unavailable' }, 503);
  }

  const { id } = await params;

  try {
    return await withFieldContext(principal, async () => {
      const invoice = await getInvoice(id);
      if (!invoice) return privateJson({ error: 'Not found' }, 404);
      const lines = await getInvoiceLines(id);
      return privateJson({ invoice, lines });
    });
  } catch (error) {
    console.error('Invoice detail failed.', error);
    return privateJson({ error: 'Invoices unavailable' }, 503);
  }
}
