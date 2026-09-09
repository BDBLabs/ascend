import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  isPartStatus,
  type PartStatus,
} from '@/lib/ascend/project-part-contract';
import { updatePartStatus } from '@/lib/ascend/project-parts';
import {
  ascendServiceError,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../../../shared';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  const raw = typeof body.status === 'string' ? body.status : '';
  if (!isPartStatus(raw)) {
    return privateJson({ error: 'Invalid status.' }, 400);
  }
  const status = raw as PartStatus;
  const note = typeof body.note === 'string' ? body.note : undefined;

  try {
    const result = await withFieldContext(gate.principal, () =>
      updatePartStatus(id, status, note),
    );
    if (!result.ok) {
      const messages = {
        'part-not-found': 'Part not found.',
        'invalid-transition': 'That status transition is not allowed.',
      } as const;
      const code = result.error === 'part-not-found' ? 404 : 409;
      return privateJson({ error: messages[result.error] }, code);
    }
    return privateJson({ part: result.part });
  } catch (error) {
    return ascendServiceError(error);
  }
}
