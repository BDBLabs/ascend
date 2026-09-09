import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  isCostCategory,
  isCostKind,
  validateCostEntryInput,
  validateLaborCostInput,
  type CostCategory,
  type CostKind,
} from '@/lib/ascend/project-cost-contract';
import { recordCostEntry, recordLaborCost } from '@/lib/ascend/project-costs';
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
const intOrNull = (v: unknown): number | null | undefined => {
  if (v === undefined || v === null) return undefined;
  return typeof v === 'number' ? v : NaN;
};

export async function POST(request: NextRequest) {
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  try {
    if (body.kind === 'labor') {
      const rawKind = str(body.costKind);
      const input = {
        projectId: typeof body.projectId === 'string' ? body.projectId : '',
        elevatorUnitId: asOptionalUuid(body.elevatorUnitId) ?? null,
        workPackageId: asOptionalUuid(body.workPackageId) ?? null,
        costKind: (rawKind && isCostKind(rawKind) ? rawKind : rawKind) as CostKind,
        hoursHundredths:
          typeof body.hoursHundredths === 'number' ? body.hoursHundredths : NaN,
        rateCentsPerHour:
          typeof body.rateCentsPerHour === 'number' ? body.rateCentsPerHour : NaN,
        costDate: typeof body.costDate === 'string' ? body.costDate : '',
        sourceType: str(body.sourceType),
        sourceRef: str(body.sourceRef),
        description: str(body.description),
      };
      const errors = validateLaborCostInput(input);
      if (errors.length) return privateJson({ error: errors.join(' ') }, 400);
      const entry = await withFieldContext(gate.principal, () =>
        recordLaborCost(input),
      );
      return privateJson({ entry }, 201);
    }

    const rawKind = str(body.costKind);
    const rawCategory = str(body.costCategory);
    const input = {
      projectId: typeof body.projectId === 'string' ? body.projectId : '',
      elevatorUnitId: asOptionalUuid(body.elevatorUnitId) ?? null,
      workPackageId: asOptionalUuid(body.workPackageId) ?? null,
      costKind: (rawKind && isCostKind(rawKind) ? rawKind : rawKind) as CostKind,
      costCategory: (rawCategory && isCostCategory(rawCategory)
        ? rawCategory
        : rawCategory) as CostCategory,
      amountCents: typeof body.amountCents === 'number' ? body.amountCents : NaN,
      laborHoursHundredths: intOrNull(body.laborHoursHundredths) ?? null,
      laborRateCentsPerHour: intOrNull(body.laborRateCentsPerHour) ?? null,
      costDate: typeof body.costDate === 'string' ? body.costDate : '',
      sourceType: str(body.sourceType),
      sourceRef: str(body.sourceRef),
      description: str(body.description),
    };
    const errors = validateCostEntryInput(input);
    if (errors.length) return privateJson({ error: errors.join(' ') }, 400);
    const entry = await withFieldContext(gate.principal, () =>
      recordCostEntry(input),
    );
    return privateJson({ entry }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
