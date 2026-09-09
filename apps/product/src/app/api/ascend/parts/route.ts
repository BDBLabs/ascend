import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { validatePartInput } from '@/lib/ascend/project-part-contract';
import { createProjectPart } from '@/lib/ascend/project-parts';
import {
  ascendServiceError,
  asOptionalUuid,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../shared';

export const dynamic = 'force-dynamic';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

export async function POST(request: NextRequest) {
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  const input = {
    projectId: typeof body.projectId === 'string' ? body.projectId : '',
    buildingId: asOptionalUuid(body.buildingId) ?? null,
    elevatorUnitId: asOptionalUuid(body.elevatorUnitId) ?? null,
    workPackageId: asOptionalUuid(body.workPackageId) ?? null,
    inventoryItemId: asOptionalUuid(body.inventoryItemId) ?? null,
    description: typeof body.description === 'string' ? body.description : '',
    quantityRequiredHundredths:
      typeof body.quantityRequiredHundredths === 'number'
        ? body.quantityRequiredHundredths
        : NaN,
    plannedCostCents:
      typeof body.plannedCostCents === 'number' ? body.plannedCostCents : undefined,
    actualCostCents:
      typeof body.actualCostCents === 'number' ? body.actualCostCents : undefined,
    supplier: str(body.supplier),
    sourceRef: str(body.sourceRef),
    neededDate:
      typeof body.neededDate === 'string' && body.neededDate !== ''
        ? body.neededDate
        : null,
    notes: str(body.notes),
  };
  const errors = validatePartInput(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const part = await withFieldContext(gate.principal, () =>
      createProjectPart(input),
    );
    return privateJson({ part }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
