import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { validateApplicationDraft } from '@/lib/ascend/billing-contract';
import { createApplicationDraft } from '@/lib/ascend/progress-billing';
import {
  ascendServiceError,
  asUuid,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../shared';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  const billingPeriodId = asUuid(body.billingPeriodId);
  if (!billingPeriodId) {
    return privateJson({ error: 'Invalid billingPeriodId.' }, 400);
  }
  const input = {
    storedMaterialsCents:
      typeof body.storedMaterialsCents === 'number'
        ? body.storedMaterialsCents
        : undefined,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
  };
  const errors = validateApplicationDraft(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const result = await withFieldContext(gate.principal, () =>
      createApplicationDraft(billingPeriodId, input),
    );
    if (!result.ok) {
      const messages = {
        'period-not-found': 'Billing period not found.',
        'period-not-open': 'Billing period is not open.',
        'already-applied': 'This period already has an application.',
        invalid: 'Invalid application draft.',
      } as const;
      const code = result.error === 'period-not-found' ? 404 : 409;
      return privateJson({ error: messages[result.error] }, code);
    }
    return privateJson({ application: result.application }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
