import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  isActivityStatus,
  type ActivityStatus,
} from '@/lib/ascend/obligation-contract';
import { setActivityStatus } from '@/lib/ascend/obligations';
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
  if (!isActivityStatus(raw)) {
    return privateJson({ error: 'Invalid status.' }, 400);
  }
  const note =
    typeof read.body.note === 'string' ? read.body.note : undefined;

  try {
    const result = await withFieldContext(gate.principal, () =>
      setActivityStatus(id, raw as ActivityStatus, note),
    );
    if (!result.ok) {
      const messages = {
        'activity-not-found': 'Activity not found.',
        'invalid-transition': 'That transition is not allowed.',
        'evidence-required':
          'Evidence is required before this activity completes.',
      } as const;
      const code = result.error === 'activity-not-found' ? 404 : 409;
      return privateJson({ error: messages[result.error] }, code);
    }
    return privateJson({ activity: result.activity });
  } catch (error) {
    return ascendServiceError(error);
  }
}
