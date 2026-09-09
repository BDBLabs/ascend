import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  linkUnitToWorkPackage,
  unlinkUnitFromWorkPackage,
} from '@/lib/ascend/work-packages';
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
      linkUnitToWorkPackage(id, unitId),
    );
    if (!result.ok) {
      const messages = {
        'package-not-found': 'Work package not found.',
        'unit-not-found': 'Elevator unit not found.',
        'already-linked': 'Unit is already linked to this package.',
      } as const;
      const status =
        result.error === 'package-not-found' ? 404 : 409;
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
      unlinkUnitFromWorkPackage(id, unitId),
    );
    return privateJson({ unlinked });
  } catch (error) {
    return ascendServiceError(error);
  }
}
