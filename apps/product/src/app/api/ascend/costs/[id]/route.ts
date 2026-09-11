import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  updateCostEntry,
  type UpdateCostEntryInput,
} from '@/lib/ascend/project-costs';
import {
  ascendServiceError,
  asOptionalUuid,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../../shared';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

/**
 * Revises a planning-figure entry. Posted actuals are immutable (409);
 * correct them with a new entry.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  if (body.costKind !== undefined || body.costCategory !== undefined) {
    return privateJson(
      { error: 'Kind and category are set at recording time.' },
      400,
    );
  }
  for (const field of ['workPackageId', 'elevatorUnitId'] as const) {
    const value = body[field];
    if (
      typeof value === 'string' &&
      value !== '' &&
      asOptionalUuid(value) === null
    ) {
      return privateJson({ error: `Invalid ${field}.` }, 400);
    }
  }
  const patch: UpdateCostEntryInput = {
    ...(typeof body.amountCents === 'number'
      ? { amountCents: body.amountCents }
      : {}),
    ...(typeof body.costDate === 'string' ? { costDate: body.costDate } : {}),
    ...(str(body.description) !== undefined
      ? { description: str(body.description) }
      : {}),
    ...(str(body.sourceType) !== undefined
      ? { sourceType: str(body.sourceType) }
      : {}),
    ...(str(body.sourceRef) !== undefined
      ? { sourceRef: str(body.sourceRef) }
      : {}),
    ...(body.workPackageId !== undefined || body.workPackageId === null
      ? { workPackageId: asOptionalUuid(body.workPackageId) ?? null }
      : {}),
    ...(body.elevatorUnitId !== undefined || body.elevatorUnitId === null
      ? { elevatorUnitId: asOptionalUuid(body.elevatorUnitId) ?? null }
      : {}),
  };
  if (Object.keys(patch).length === 0) {
    return privateJson({ error: 'Nothing to update.' }, 400);
  }

  try {
    const result = await withFieldContext(gate.principal, () =>
      updateCostEntry(id, patch),
    );
    if (!result.ok) {
      const messages = {
        'entry-not-found': 'Cost entry not found.',
        immutable:
          'Posted actuals are immutable; record a correcting entry instead.',
        invalid: 'Invalid cost entry.',
      } as const;
      const code = result.error === 'entry-not-found' ? 404 : 409;
      return privateJson({ error: messages[result.error] }, code);
    }
    return privateJson({ entry: result.entry });
  } catch (error) {
    return ascendServiceError(error);
  }
}
