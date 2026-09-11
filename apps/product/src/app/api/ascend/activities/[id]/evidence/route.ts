import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  isEvidenceKind,
  validateEvidenceInput,
  type EvidenceKind,
} from '@/lib/ascend/obligation-contract';
import { attachEvidence } from '@/lib/ascend/obligations';
import {
  ascendServiceError,
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
  const body = read.body;

  const rawKind = typeof body.kind === 'string' ? body.kind : '';
  const input = {
    kind: (isEvidenceKind(rawKind) ? rawKind : rawKind) as EvidenceKind,
    ref: typeof body.ref === 'string' ? body.ref : undefined,
    note: typeof body.note === 'string' ? body.note : undefined,
  };
  const errors = validateEvidenceInput(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const result = await withFieldContext(gate.principal, () =>
      attachEvidence(id, input),
    );
    if (!result.ok) {
      const code = result.error === 'activity-not-found' ? 404 : 400;
      return privateJson(
        {
          error:
            result.error === 'activity-not-found'
              ? 'Activity not found.'
              : 'Invalid evidence.',
        },
        code,
      );
    }
    return privateJson({ evidence: result.evidence }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
