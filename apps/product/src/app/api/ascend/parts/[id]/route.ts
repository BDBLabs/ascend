import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  updateProjectPart,
  type UpdateProjectPartInput,
} from '@/lib/ascend/project-parts';
import {
  ascendServiceError,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../../shared';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

/**
 * Updates descriptive part fields. Status travels through the status
 * endpoint and quantities through the quantity endpoint.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  if (
    body.status !== undefined ||
    body.quantityReceivedHundredths !== undefined ||
    body.quantityInstalledHundredths !== undefined ||
    body.actualCostCents !== undefined
  ) {
    return privateJson(
      { error: 'Use the status and quantity endpoints for those fields.' },
      400,
    );
  }
  const patch: UpdateProjectPartInput = {
    ...(str(body.description) !== undefined
      ? { description: str(body.description) }
      : {}),
    ...(str(body.supplier) !== undefined ? { supplier: str(body.supplier) } : {}),
    ...(str(body.sourceRef) !== undefined
      ? { sourceRef: str(body.sourceRef) }
      : {}),
    ...(body.neededDate !== undefined
      ? {
          neededDate:
            typeof body.neededDate === 'string' && body.neededDate !== ''
              ? body.neededDate
              : null,
        }
      : {}),
    ...(str(body.notes) !== undefined ? { notes: str(body.notes) } : {}),
    ...(typeof body.plannedCostCents === 'number'
      ? { plannedCostCents: body.plannedCostCents }
      : {}),
  };
  if (Object.keys(patch).length === 0) {
    return privateJson({ error: 'Nothing to update.' }, 400);
  }

  try {
    const part = await withFieldContext(gate.principal, () =>
      updateProjectPart(id, patch),
    );
    if (!part) return privateJson({ error: 'Part not found.' }, 404);
    return privateJson({ part });
  } catch (error) {
    return ascendServiceError(error);
  }
}
