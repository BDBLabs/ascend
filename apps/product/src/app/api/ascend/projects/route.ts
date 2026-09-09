import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  isProjectStatus,
  validateProjectInput,
  type ProjectStatus,
} from '@/lib/ascend/ascend-contract';
import { createModernizationProject } from '@/lib/ascend/modernization-projects';
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

  const rawStatus = str(body.status);
  const input = {
    displayId: typeof body.displayId === 'string' ? body.displayId.trim() : '',
    customerId: typeof body.customerId === 'string' ? body.customerId : '',
    buildingId: asOptionalUuid(body.buildingId) ?? null,
    status: (rawStatus && isProjectStatus(rawStatus) ? rawStatus : rawStatus) as
      | ProjectStatus
      | undefined,
    contractValueCents:
      typeof body.contractValueCents === 'number' ? body.contractValueCents : 0,
    projectManager: str(body.projectManager),
    startDate: dateOrNull(body.startDate) ?? null,
    targetCompletionDate: dateOrNull(body.targetCompletionDate) ?? null,
    actualCompletionDate: dateOrNull(body.actualCompletionDate) ?? null,
    notes: str(body.notes),
  };
  const errors = validateProjectInput(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const project = await withFieldContext(gate.principal, () =>
      createModernizationProject(input),
    );
    return privateJson({ project }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
