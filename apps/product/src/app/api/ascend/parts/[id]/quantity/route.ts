import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { validatePartQuantity } from '@/lib/ascend/project-part-contract';
import { recordPartQuantity } from '@/lib/ascend/project-parts';
import {
  ascendServiceError,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../../../shared';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const intOrUndefined = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined;

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  const input = {
    quantityReceivedHundredths: intOrUndefined(body.quantityReceivedHundredths),
    quantityInstalledHundredths: intOrUndefined(body.quantityInstalledHundredths),
    actualCostCents: intOrUndefined(body.actualCostCents),
    note: typeof body.note === 'string' ? body.note : undefined,
  };
  const errors = validatePartQuantity(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const result = await withFieldContext(gate.principal, () =>
      recordPartQuantity(id, input),
    );
    if (!result.ok) {
      const messages = {
        'part-not-found': 'Part not found.',
        invalid: 'Quantities and costs only move upward; correct by note.',
      } as const;
      const code = result.error === 'part-not-found' ? 404 : 400;
      return privateJson({ error: messages[result.error] }, code);
    }
    return privateJson({ part: result.part });
  } catch (error) {
    return ascendServiceError(error);
  }
}
