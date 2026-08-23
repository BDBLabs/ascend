import type { NextRequest } from 'next/server';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { JOB_STATUSES, type JobStatus } from '@/lib/job-contract';
import { updateJobStatus } from '@/lib/jobs';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'jobs.write')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Service unavailable' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await _request.json()) as Record<string, unknown>;
  } catch {
    return privateJson({ error: 'Invalid body' }, 400);
  }

  const status = body.status as string | undefined;
  if (!status || !(JOB_STATUSES as readonly string[]).includes(status)) {
    return privateJson({ error: 'Invalid status' }, 400);
  }

  const { id } = await params;

  try {
    return await withFieldContext(principal, async () => {
      const job = await updateJobStatus(id, status as JobStatus);
      if (!job) {
        return privateJson({ error: 'Job not found' }, 404);
      }
      return privateJson({ job });
    });
  } catch (error) {
    console.error('Failed to update job status:', error);
    return privateJson({ error: 'Failed to update job status' }, 503);
  }
}
