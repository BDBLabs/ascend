import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  linkElevatorToProject,
  unlinkElevatorFromProject,
} from '@/lib/ascend/modernization-projects';
import {
  ascendServiceError,
  asUuid,
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

  const unitId = asUuid(read.body.unitId);
  if (!unitId) return privateJson({ error: 'Invalid unitId.' }, 400);

  try {
    const result = await withFieldContext(gate.principal, () =>
      linkElevatorToProject(id, unitId),
    );
    if (!result.ok) {
      const messages = {
        'project-not-found': 'Project not found.',
        'unit-not-found': 'Elevator unit not found.',
        'already-linked': 'Unit is already linked to this project.',
      } as const;
      const status =
        result.error === 'already-linked' || result.error === 'unit-not-found'
          ? 409
          : 404;
      return privateJson({ error: messages[result.error] }, status);
    }
    return privateJson({ link: result }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;

  const unitId = asUuid(new URL(request.url).searchParams.get('unitId'));
  if (!unitId) return privateJson({ error: 'Invalid unitId.' }, 400);

  try {
    const unlinked = await withFieldContext(gate.principal, () =>
      unlinkElevatorFromProject(id, unitId),
    );
    return privateJson({ unlinked });
  } catch (error) {
    return ascendServiceError(error);
  }
}
