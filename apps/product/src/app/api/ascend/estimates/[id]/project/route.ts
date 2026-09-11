import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  linkEstimateToProject,
  unlinkEstimateFromProject,
} from '@/lib/ascend/estimate-links';
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

  const projectId = asUuid(read.body.projectId);
  if (!projectId) return privateJson({ error: 'Invalid projectId.' }, 400);

  try {
    const result = await withFieldContext(gate.principal, () =>
      linkEstimateToProject(id, projectId),
    );
    if (!result.ok) {
      const messages = {
        'project-not-found': 'Project not found.',
        'estimate-not-found': 'Estimate not found.',
        'estimate-not-signed': 'Only signed estimates become projects.',
        'customer-mismatch': 'Estimate and project customers differ.',
        'already-linked': 'This bid already feeds a project.',
      } as const;
      const code =
        result.error === 'project-not-found' ||
        result.error === 'estimate-not-found'
          ? 404
          : 409;
      return privateJson({ error: messages[result.error] }, code);
    }
    return privateJson({ link: result }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}

export async function DELETE(request: NextRequest, _context: RouteContext) {
  const gate = await gateAscendWrite(request, 'jobs.write');
  if ('response' in gate) return gate.response;

  const projectId = asUuid(new URL(request.url).searchParams.get('projectId'));
  if (!projectId) return privateJson({ error: 'Invalid projectId.' }, 400);

  try {
    const unlinked = await withFieldContext(gate.principal, () =>
      unlinkEstimateFromProject(projectId),
    );
    return privateJson({ unlinked });
  } catch (error) {
    return ascendServiceError(error);
  }
}
