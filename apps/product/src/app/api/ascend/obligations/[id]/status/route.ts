import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  isObligationStatus,
  type ObligationStatus,
} from '@/lib/ascend/obligation-contract';
import { setObligationStatus } from '@/lib/ascend/obligations';
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
  if (!isObligationStatus(raw)) {
    return privateJson({ error: 'Invalid status.' }, 400);
  }
  const note =
    typeof read.body.note === 'string' ? read.body.note : undefined;

  try {
    const result = await withFieldContext(gate.principal, () =>
      setObligationStatus(id, raw as ObligationStatus, note),
    );
    if (!result.ok) {
      const code =
        result.error === 'obligation-not-found' ? 404 : 409;
      return privateJson(
        {
          error:
            result.error === 'obligation-not-found'
              ? 'Obligation not found.'
              : 'That transition is not allowed.',
        },
        code,
      );
    }
    return privateJson({ obligation: result.obligation });
  } catch (error) {
    return ascendServiceError(error);
  }
}
