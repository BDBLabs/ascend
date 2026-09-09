import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { validateWorkPackageInput } from '@/lib/ascend/work-package-contract';
import { createWorkPackage } from '@/lib/ascend/work-packages';
import {
  ascendServiceError,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../shared';

export const dynamic = 'force-dynamic';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;
const cents = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined;
const dateOrNull = (v: unknown): string | null | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  return typeof v === 'string' ? v : '';
};

export async function POST(request: NextRequest) {
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  const input = {
    projectId: typeof body.projectId === 'string' ? body.projectId : '',
    name: typeof body.name === 'string' ? body.name : '',
    category: str(body.category),
    description: str(body.description),
    budgetCostCents: cents(body.budgetCostCents),
    contractValueCents: cents(body.contractValueCents),
    plannedStart: dateOrNull(body.plannedStart) ?? null,
    plannedFinish: dateOrNull(body.plannedFinish) ?? null,
    actualStart: dateOrNull(body.actualStart) ?? null,
    actualFinish: dateOrNull(body.actualFinish) ?? null,
    responsiblePerson: str(body.responsiblePerson),
    notes: str(body.notes),
  };
  const errors = validateWorkPackageInput(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const workPackage = await withFieldContext(gate.principal, () =>
      createWorkPackage(input),
    );
    return privateJson({ workPackage }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
