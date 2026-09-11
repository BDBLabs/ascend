import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { validateMilestoneInput } from '@/lib/ascend/obligation-contract';
import { createMilestone } from '@/lib/ascend/obligations';
import {
  ascendServiceError,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../shared';

export const dynamic = 'force-dynamic';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

export async function POST(request: NextRequest) {
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  const input = {
    obligationId: typeof body.obligationId === 'string' ? body.obligationId : '',
    title: typeof body.title === 'string' ? body.title : '',
    description: str(body.description),
    dueDate:
      typeof body.dueDate === 'string' && body.dueDate !== ''
        ? body.dueDate
        : null,
  };
  const errors = validateMilestoneInput(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const milestone = await withFieldContext(gate.principal, () =>
      createMilestone(input),
    );
    return privateJson({ milestone }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
