import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { controlQuery } from '@/lib/control-db';

/**
 * Operator identity actions (P2.1 / P2.3 / P5). These replace the product's
 * FIELD_PROVISION_SECRET endpoint, which let any holder of one shared secret
 * reset any user's password and reactivate any user from any tenant.
 *
 * Each call goes through a SECURITY DEFINER window (migration 035) that
 * changes only what it names, bumps auth versions (revoking affected sessions)
 * and writes an identity_audit_events row with the operator id -- all in one
 * transaction.
 *
 * Set-password and reset tokens are 256-bit, returned ONCE to the operator for
 * out-of-band delivery (outbound email is held, P0.2), and stored only as
 * SHA-256 hashes. The link is <product>/field/reset-password?token=...
 */

const ROLES = new Set(['owner', 'office', 'technician']);
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest('hex') };
}

export class StaffActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'StaffActionError';
  }
}

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  if (code === '55000') throw new StaffActionError('the platform identity is suspended; reactivate it explicitly first', 409);
  if (code === '42501') throw new StaffActionError('this login belongs to other organizations too; pass platformAuthorized to reset it', 403);
  if (code === '23503') throw new StaffActionError('organization not found or not provisionable', 404);
  if (code === '22023') throw new StaffActionError(message, 400);
  throw error;
}

export async function provisionStaff(input: {
  actor: string;
  organizationId: string;
  email: unknown;
  displayName: unknown;
  role: unknown;
}) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim().slice(0, 160) : '';
  if (!EMAIL_PATTERN.test(email)) throw new StaffActionError('a valid email is required', 400);
  if (typeof input.role !== 'string' || !ROLES.has(input.role)) {
    throw new StaffActionError('role must be owner, office or technician', 400);
  }

  const initial = newToken();
  let rows;
  try {
    rows = await controlQuery(
      'SELECT * FROM control_staff_provision($1, $2::uuid, $3, $4, $5, $6, $7)',
      [input.actor, input.organizationId, email, displayName, input.role, initial.hash, 7 * 86400],
    );
  } catch (error) {
    mapDatabaseError(error);
  }
  const row = rows[0];
  return {
    platformUserId: String(row.platform_user_id),
    membershipId: String(row.membership_id),
    createdUser: Boolean(row.created_user),
    // Present only when the identity has no password yet.
    setPasswordToken: row.initial_token_issued ? initial.token : null,
  };
}

export async function setStaffRole(actor: string, organizationId: string, userId: string, role: unknown) {
  if (typeof role !== 'string' || !ROLES.has(role)) throw new StaffActionError('invalid role', 400);
  const rows = await controlQuery('SELECT control_staff_set_role($1, $2::uuid, $3::uuid, $4) AS ok',
    [actor, organizationId, userId, role]);
  if (!rows[0]?.ok) throw new StaffActionError('active membership not found', 404);
}

export async function revokeStaff(actor: string, organizationId: string, userId: string) {
  const rows = await controlQuery('SELECT control_staff_revoke($1, $2::uuid, $3::uuid) AS ok',
    [actor, organizationId, userId]);
  if (!rows[0]?.ok) throw new StaffActionError('active membership not found', 404);
}

export async function issuePasswordReset(
  actor: string,
  organizationId: string,
  userId: string,
  platformAuthorized: boolean,
) {
  const reset = newToken();
  let rows;
  try {
    rows = await controlQuery(
      'SELECT control_password_reset_issue($1, $2::uuid, $3::uuid, $4, $5, $6) AS ok',
      [actor, organizationId, userId, reset.hash, 3600, platformAuthorized],
    );
  } catch (error) {
    mapDatabaseError(error);
  }
  if (!rows[0]?.ok) throw new StaffActionError('active membership not found', 404);
  return { resetToken: reset.token, expiresInSeconds: 3600 };
}

export async function setIdentityStatus(actor: string, userId: string, status: unknown, reason: unknown) {
  if (status !== 'active' && status !== 'suspended') throw new StaffActionError('status must be active or suspended', 400);
  if (typeof reason !== 'string' || reason.trim().length < 5) throw new StaffActionError('a reason is required', 400);
  const rows = await controlQuery('SELECT control_identity_set_status($1, $2::uuid, $3, $4) AS changed',
    [actor, userId, status, reason.trim().slice(0, 500)]);
  return { changed: Boolean(rows[0]?.changed) };
}

export async function listAuditEvents(filter: { organizationId?: string; limit?: number }) {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const rows = await controlQuery(
    `SELECT id, to_json(occurred_at) AS occurred_at, actor, action, organization_id, platform_user_id, detail
       FROM identity_audit_events
      WHERE $1::uuid IS NULL OR organization_id = $1::uuid
      ORDER BY id DESC
      LIMIT $2`,
    [filter.organizationId ?? null, limit],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    occurredAt: String(row.occurred_at),
    actor: String(row.actor),
    action: String(row.action),
    organizationId: row.organization_id ? String(row.organization_id) : null,
    platformUserId: row.platform_user_id ? String(row.platform_user_id) : null,
    detail: row.detail as Record<string, unknown>,
  }));
}
