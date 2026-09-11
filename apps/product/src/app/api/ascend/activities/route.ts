import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { validateActivityInput } from '@/lib/ascend/obligation-contract';
import { createActivity } from '@/lib/ascend/obligations';
import {
  ascendServiceError,
  asOptionalUuid,
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
    milestoneId: typeof body.milestoneId === 'string' ? body.milestoneId : '',
    workPackageId: asOptionalUuid(body.workPackageId) ?? null,
    title: typeof body.title === 'string' ? body.title : '',
    description: str(body.description),
    evidenceRequired:
      typeof body.evidenceRequired === 'boolean'
        ? body.evidenceRequired
        : undefined,
  };
  const errors = validateActivityInput(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const activity = await withFieldContext(gate.principal, () =>
      createActivity(input),
    );
    return privateJson({ activity }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
