import type { NextRequest } from 'next/server';
import { db, isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { verificationRecord } from '@/lib/dns-verification';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * GET /api/field/domains — list all domains for the current organization.
 * Returns the canonical *.usejbox.com domain and any custom domains.
 */
export async function GET() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'organization.configure')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Domains unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const sql = db();
      const rows = await sql.query(
        `SELECT id, hostname, is_canonical, verified, verified_at, created_at
         FROM organization_domains
         ORDER BY is_canonical DESC, created_at ASC`,
      );

      const domains = rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        hostname: String(row.hostname),
        isCanonical: Boolean(row.is_canonical),
        verified: Boolean(row.verified),
        verifiedAt: row.verified_at ? String(row.verified_at) : null,
        createdAt: String(row.created_at),
      }));

      return privateJson({ ok: true, domains });
    });
  } catch (error) {
    console.error('Domain list failed.', error);
    return privateJson({ error: 'Domains unavailable' }, 503);
  }
}

/**
 * POST /api/field/domains — add a custom domain to the current organization.
 * Body: { "hostname": "smithplumbing.com" }
 */
export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'organization.configure')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Domains unavailable' }, 503);
  }

  let body: { hostname?: unknown };
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'request body must be JSON' }, 400);
  }

  if (typeof body.hostname !== 'string' || !body.hostname.trim()) {
    return privateJson({ error: 'hostname is required' }, 400);
  }

  const hostname = body.hostname.trim().toLowerCase();

  // Validate hostname format
  if (!HOSTNAME_PATTERN.test(hostname)) {
    return privateJson({ error: 'hostname is not a valid domain' }, 400);
  }

  // Check if this is a *.usejbox.com subdomain (reserved)
  if (hostname.endsWith('.usejbox.com')) {
    return privateJson({ error: 'cannot add *.usejbox.com subdomains as custom domains' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      let rows: Array<Record<string, unknown>>;
      try {
        rows = await db().query('SELECT id, hostname, verification_token FROM tenant_domain_add($1)', [hostname]);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          return privateJson({ error: 'hostname already in use' }, 409);
        }
        throw error;
      }
      const row = rows[0];
      const record = verificationRecord(String(row.hostname), String(row.verification_token));
      return privateJson({
        ok: true,
        domain: {
          id: String(row.id),
          hostname: String(row.hostname),
          isCanonical: false,
          verified: false,
          verifiedAt: null,
        },
        // Publish this record, then POST /api/field/domains/{id}/verify.
        verification: { type: 'TXT', name: record.name, value: record.value },
      }, 201);
    });
  } catch (error) {
    console.error('Domain add failed.', error);
    return privateJson({ error: 'Domain add failed' }, 500);
  }
}
