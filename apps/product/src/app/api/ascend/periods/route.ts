import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { validateBillingPeriod } from '@/lib/ascend/billing-contract';
import { createBillingPeriod } from '@/lib/ascend/progress-billing';
import {
  ascendServiceError,
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

  const input = {
    projectId: typeof body.projectId === 'string' ? body.projectId : '',
    periodNumber: typeof body.periodNumber === 'number' ? body.periodNumber : NaN,
    periodStart: typeof body.periodStart === 'string' ? body.periodStart : '',
    periodEnd: typeof body.periodEnd === 'string' ? body.periodEnd : '',
  };
  const errors = validateBillingPeriod(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const period = await withFieldContext(gate.principal, () =>
      createBillingPeriod(input),
    );
    return privateJson({ period }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
