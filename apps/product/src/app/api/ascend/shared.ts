/**
 * Shared glue for the Ascend write API. Capability mapping (documented
 * once, here): buildings and elevator units are account master data
 * (customers.write); projects, packages, progress, costs, parts, and
 * billing are execution writes (jobs.write). Every staff role holds
 * jobs.write; only office and owner hold customers.write.
 */
import type { NextRequest } from 'next/server';
import type { Capability } from '@contractor-platform/domain';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
  type FieldPrincipal,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson, readJsonBody, RequestBodyTooLargeError } from '@/lib/http';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

export const ASCEND_MAX_BODY_BYTES = 32768;

export async function gateAscendWrite(
  request: NextRequest,
  capability: Capability,
): Promise<{ principal: FieldPrincipal } | { response: Response }> {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, capability)) {
    return { response: privateJson({ error: 'Unauthorized' }, 401) };
  }
  if (!publicRequestIsSameOrigin(request)) {
    return { response: privateJson({ error: 'Forbidden' }, 403) };
  }
  if (!isDatabaseConfigured()) {
    return { response: privateJson({ error: 'Service unavailable' }, 503) };
  }
  return { principal: principal as FieldPrincipal };
}

export async function readAscendBody(
  request: NextRequest,
): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  let body: unknown;
  try {
    body = await readJsonBody(request, ASCEND_MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { response: privateJson({ error: 'Bad Request' }, 400) };
    }
    return { response: privateJson({ error: 'Invalid body' }, 400) };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { response: privateJson({ error: 'Body must be an object.' }, 400) };
  }
  return { body: body as Record<string, unknown> };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

export function asOptionalUuid(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return asUuid(value);
}

/** Maps service-layer throws to status-coded responses. */
export function ascendServiceError(error: unknown): Response {
  if (error instanceof Error) {
    if (/^Invalid .*:/.test(error.message)) {
      return privateJson({ error: error.message }, 400);
    }
    if (/foreign key|violates.*fkey|referenced record/i.test(error.message)) {
      return privateJson({ error: 'Related record not found.' }, 409);
    }
    if (/duplicate key|unique constraint|already exists/i.test(error.message)) {
      return privateJson({ error: 'Record already exists.' }, 409);
    }
  }
  console.error('Ascend write failed.', error);
  return privateJson({ error: 'Service unavailable' }, 503);
}

export { withFieldContext };
