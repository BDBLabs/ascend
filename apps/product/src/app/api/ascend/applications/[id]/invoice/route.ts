import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { createInvoiceForApplication } from '@/lib/ascend/application-invoices';
import {
  ascendServiceError,
  gateAscendWrite,
  withFieldContext,
} from '../../../shared';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Creates the draft J-Box invoice for an approved application and files
 * the linkage (same path as a manually linked invoice). No body.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;

  try {
    const result = await withFieldContext(gate.principal, () =>
      createInvoiceForApplication(id),
    );
    if (!result.ok) {
      const messages = {
        'application-not-found': 'Application not found.',
        'not-approved': 'Only approved applications become invoices.',
        'nothing-due':
          'Nothing to invoice: the amount due is zero or a credit.',
        'invoice-not-found': 'Invoice linkage failed.',
      } as const;
      const code =
        result.error === 'application-not-found' ||
        result.error === 'invoice-not-found'
          ? 404
          : 409;
      return privateJson({ error: messages[result.error] }, code);
    }
    return privateJson(
      { invoiceId: result.invoiceId, reused: result.reused },
      result.reused ? 200 : 201,
    );
  } catch (error) {
    return ascendServiceError(error);
  }
}
