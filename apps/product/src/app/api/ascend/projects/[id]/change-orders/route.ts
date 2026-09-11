import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  linkChangeOrderToProject,
  unlinkChangeOrderFromProject,
} from '@/lib/ascend/change-order-links';
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

  const changeOrderId = asUuid(read.body.changeOrderId);
  if (!changeOrderId) {
    return privateJson({ error: 'Invalid changeOrderId.' }, 400);
  }

  try {
    const result = await withFieldContext(gate.principal, () =>
      linkChangeOrderToProject(changeOrderId, id),
    );
    if (!result.ok) {
      const messages = {
        'project-not-found': 'Project not found.',
        'change-order-not-found': 'Change order not found.',
        'customer-mismatch': 'Change order and project customers differ.',
        'already-linked': 'This change order already belongs to a project.',
      } as const;
      const code =
        result.error === 'project-not-found' ||
        result.error === 'change-order-not-found'
          ? 404
          : 409;
      return privateJson({ error: messages[result.error] }, code);
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

  const changeOrderId = asUuid(
    new URL(request.url).searchParams.get('changeOrderId'),
  );
  if (!changeOrderId) {
    return privateJson({ error: 'Invalid changeOrderId.' }, 400);
  }

  try {
    const unlinked = await withFieldContext(gate.principal, () =>
      unlinkChangeOrderFromProject(id, changeOrderId),
    );
    return privateJson({ unlinked });
  } catch (error) {
    return ascendServiceError(error);
  }
}
