import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  approveApplication,
  markApplicationInvoiced,
  rejectApplication,
  submitApplication,
  voidApplicationDraft,
} from '@/lib/ascend/progress-billing';
import {
  ascendServiceError,
  asUuid,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../../shared';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const ACTIONS = ['submit', 'approve', 'reject', 'void', 'invoice'] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  const action = (
    typeof body.action === 'string' &&
    (ACTIONS as readonly string[]).includes(body.action)
      ? body.action
      : null
  ) as Action | null;
  if (!action) return privateJson({ error: 'Invalid action.' }, 400);
  const note = typeof body.note === 'string' ? body.note : undefined;

  try {
    const result = await withFieldContext(gate.principal, async () => {
      switch (action) {
        case 'submit':
          return submitApplication(id, note);
        case 'approve':
          return approveApplication(id, note);
        case 'reject':
          return rejectApplication(id, note);
        case 'void': {
          const voided = await voidApplicationDraft(id);
          if (!voided.ok) return voided;
          return { ok: true as const, voided: true as const };
        }
        case 'invoice': {
          const invoiceId = asUuid(body.invoiceId);
          if (!invoiceId) {
            return { ok: false as const, error: 'invoice-not-found' as const };
          }
          return markApplicationInvoiced(id, invoiceId);
        }
      }
    });

    if ('voided' in result) return privateJson({ voided: true });
    if (!result.ok) {
      const messages = {
        'application-not-found': 'Application not found.',
        'invalid-transition': 'That transition is not allowed from here.',
        'invoice-not-found': 'Invoice not found.',
        'not-draft': 'Only drafts can be voided.',
      } as const;
      const code =
        result.error === 'application-not-found' ||
        result.error === 'invoice-not-found'
          ? 404
          : 409;
      return privateJson({ error: messages[result.error] }, code);
    }
    return privateJson({ application: result.application });
  } catch (error) {
    return ascendServiceError(error);
  }
}
