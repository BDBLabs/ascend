import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { validateBillingSchedule } from '@/lib/ascend/billing-contract';
import { setBillingSchedule } from '@/lib/ascend/progress-billing';
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
    retainagePercent:
      typeof body.retainagePercent === 'number' ? body.retainagePercent : NaN,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
  };
  const errors = validateBillingSchedule(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const schedule = await withFieldContext(gate.principal, () =>
      setBillingSchedule(input),
    );
    return privateJson({ schedule });
  } catch (error) {
    return ascendServiceError(error);
  }
}
