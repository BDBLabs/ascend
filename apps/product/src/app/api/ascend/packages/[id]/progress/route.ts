import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  isWorkPackageStatus,
  validateWorkPackageProgress,
  type WorkPackageStatus,
} from '@/lib/ascend/work-package-contract';
import { recordWorkPackageProgress } from '@/lib/ascend/work-packages';
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

  const rawStatus =
    typeof body.status === 'string' && body.status !== '' ? body.status : undefined;
  const input = {
    percentComplete: typeof body.percentComplete === 'number' ? body.percentComplete : NaN,
    status: (rawStatus && isWorkPackageStatus(rawStatus) ? rawStatus : rawStatus) as
      | WorkPackageStatus
      | undefined,
    note: typeof body.note === 'string' ? body.note : undefined,
  };
  const errors = validateWorkPackageProgress(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const result = await withFieldContext(gate.principal, () =>
      recordWorkPackageProgress(id, input),
    );
    if (!result.ok) {
      const messages = {
        'package-not-found': 'Work package not found.',
        invalid: 'Invalid progress report.',
        terminal: 'Cancelled packages are terminal and accept no further progress.',
      } as const;
      const status = result.error === 'package-not-found' ? 404 : 409;
      return privateJson({ error: messages[result.error] }, status);
    }
    return privateJson({ package: result.package });
  } catch (error) {
    return ascendServiceError(error);
  }
}
