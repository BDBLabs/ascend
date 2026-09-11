import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  isMilestoneStatus,
  type MilestoneStatus,
} from '@/lib/ascend/obligation-contract';
import { setMilestoneStatus } from '@/lib/ascend/obligations';
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

  const raw = typeof read.body.status === 'string' ? read.body.status : '';
  if (!isMilestoneStatus(raw)) {
    return privateJson({ error: 'Invalid status.' }, 400);
  }
  const note =
    typeof read.body.note === 'string' ? read.body.note : undefined;

  try {
    const result = await withFieldContext(gate.principal, () =>
      setMilestoneStatus(id, raw as MilestoneStatus, note),
    );
    if (!result.ok) {
      const code =
        result.error === 'milestone-not-found' ? 404 : 409;
      return privateJson(
        {
          error:
            result.error === 'milestone-not-found'
              ? 'Milestone not found.'
              : 'That transition is not allowed.',
        },
        code,
      );
    }
    return privateJson({ milestone: result.milestone });
  } catch (error) {
    return ascendServiceError(error);
  }
}
