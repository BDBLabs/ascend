import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  updateWorkPackage,
  type UpdateWorkPackageInput,
} from '@/lib/ascend/work-packages';
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
const dateOrNull = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return typeof v === 'string' ? v : '';
};
const cents = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined;

/**
 * Updates descriptive package fields. Status and percent travel only
 * through the progress endpoint (with its audit event).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  if (body.status !== undefined || body.percentComplete !== undefined) {
    return privateJson(
      { error: 'Report progress through the progress endpoint.' },
      400,
    );
  }
  const patch: UpdateWorkPackageInput = {
    ...(str(body.name) !== undefined ? { name: str(body.name) } : {}),
    ...(str(body.category) !== undefined ? { category: str(body.category) } : {}),
    ...(str(body.description) !== undefined
      ? { description: str(body.description) }
      : {}),
    ...(cents(body.budgetCostCents) !== undefined
      ? { budgetCostCents: cents(body.budgetCostCents) }
      : {}),
    ...(cents(body.contractValueCents) !== undefined
      ? { contractValueCents: cents(body.contractValueCents) }
      : {}),
    ...(dateOrNull(body.plannedStart) !== undefined
      ? { plannedStart: dateOrNull(body.plannedStart) ?? null }
      : {}),
    ...(dateOrNull(body.plannedFinish) !== undefined
      ? { plannedFinish: dateOrNull(body.plannedFinish) ?? null }
      : {}),
    ...(dateOrNull(body.actualStart) !== undefined
      ? { actualStart: dateOrNull(body.actualStart) ?? null }
      : {}),
    ...(dateOrNull(body.actualFinish) !== undefined
      ? { actualFinish: dateOrNull(body.actualFinish) ?? null }
      : {}),
    ...(str(body.responsiblePerson) !== undefined
      ? { responsiblePerson: str(body.responsiblePerson) }
      : {}),
    ...(str(body.notes) !== undefined ? { notes: str(body.notes) } : {}),
  };
  if (Object.keys(patch).length === 0) {
    return privateJson({ error: 'Nothing to update.' }, 400);
  }

  try {
    const workPackage = await withFieldContext(gate.principal, () =>
      updateWorkPackage(id, patch),
    );
    if (!workPackage) {
      return privateJson({ error: 'Work package not found.' }, 404);
    }
    return privateJson({ workPackage });
  } catch (error) {
    return ascendServiceError(error);
  }
}
