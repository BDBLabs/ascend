import type { NextRequest } from 'next/server';
import { db, isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { hasVerificationRecord, verificationRecord } from '@/lib/dns-verification';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/field/domains/[id]/verify — verify a custom domain by DNS.
 * The hostname must publish `_jbox-verify.<hostname> TXT jbox-verify=<token>`
 * with the token stored when the domain was added (migration 036). Only then
 * is the tenant-scoped mark-verified window called, with that same token.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'organization.configure')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Domains unavailable' }, 503);
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return privateJson({ error: 'Invalid domain id' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      const sql = db();
      const challenges = await sql.query(
        'SELECT hostname, verification_token, verified FROM tenant_domain_challenge($1::uuid)',
        [id],
      );
      const challenge = challenges[0] as { hostname: string; verification_token: string | null; verified: boolean } | undefined;
      if (!challenge) {
        return privateJson({ error: 'Domain not found' }, 404);
      }
      if (challenge.verified) {
        return privateJson({ ok: true, verified: true, message: 'Domain is already verified' });
      }
      if (!challenge.verification_token) {
        return privateJson({ error: 'Domain has no verification challenge' }, 409);
      }

      const record = verificationRecord(challenge.hostname, challenge.verification_token);
      if (!(await hasVerificationRecord(challenge.hostname, challenge.verification_token))) {
        return privateJson({
          ok: false,
          verified: false,
          error: 'Verification record not found yet. DNS changes can take a while to propagate.',
          verification: { type: 'TXT', name: record.name, value: record.value },
        }, 409);
      }

      const marked = await sql.query(
        'SELECT tenant_domain_mark_verified($1::uuid, $2::text) AS verified',
        [id, challenge.verification_token],
      );
      return privateJson({ ok: true, verified: Boolean(marked[0]?.verified) });
    });
  } catch (error) {
    console.error('Domain verify failed.', error);
    return privateJson({ error: 'Domain verification failed' }, 500);
  }
}
