import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  isProjectStatus,
  type ProjectStatus,
} from '@/lib/ascend/ascend-contract';
import {
  updateModernizationProject,
  type UpdateProjectInput,
} from '@/lib/ascend/modernization-projects';
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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  const rawStatus = str(body.status);
  if (rawStatus !== undefined && !isProjectStatus(rawStatus)) {
    return privateJson({ error: 'Invalid status.' }, 400);
  }
  const patch: UpdateProjectInput = {
    ...(rawStatus ? { status: rawStatus as ProjectStatus } : {}),
    ...(typeof body.contractValueCents === 'number'
      ? { contractValueCents: body.contractValueCents }
      : {}),
    ...(str(body.projectManager) !== undefined
      ? { projectManager: str(body.projectManager) }
      : {}),
    ...(dateOrNull(body.startDate) !== undefined
      ? { startDate: dateOrNull(body.startDate) ?? null }
      : {}),
    ...(dateOrNull(body.targetCompletionDate) !== undefined
      ? { targetCompletionDate: dateOrNull(body.targetCompletionDate) ?? null }
      : {}),
    ...(dateOrNull(body.actualCompletionDate) !== undefined
      ? { actualCompletionDate: dateOrNull(body.actualCompletionDate) ?? null }
      : {}),
    ...(str(body.notes) !== undefined ? { notes: str(body.notes) } : {}),
  };
  if (Object.keys(patch).length === 0) {
    return privateJson({ error: 'Nothing to update.' }, 400);
  }

  try {
    const project = await withFieldContext(gate.principal, () =>
      updateModernizationProject(id, patch),
    );
    if (!project) return privateJson({ error: 'Project not found.' }, 404);
    return privateJson({ project });
  } catch (error) {
    return ascendServiceError(error);
  }
}
