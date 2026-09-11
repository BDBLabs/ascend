import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { validateObligationInput } from '@/lib/ascend/obligation-contract';
import { createObligation } from '@/lib/ascend/obligations';
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
    projectId: typeof body.projectId === 'string' ? body.projectId : '',
    title: typeof body.title === 'string' ? body.title : '',
    description: str(body.description),
    sourceRef: str(body.sourceRef),
    dueDate:
      typeof body.dueDate === 'string' && body.dueDate !== ''
        ? body.dueDate
        : null,
  };
  const errors = validateObligationInput(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const obligation = await withFieldContext(gate.principal, () =>
      createObligation(input),
    );
    return privateJson({ obligation }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
