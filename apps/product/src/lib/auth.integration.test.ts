/**
 * P2 exit evidence at the application layer: the real auth.ts against a real
 * PostgreSQL built by the migration runner, through the jbox_runtime login.
 *
 * Runs when INTEGRATION_DATABASE_URL (jbox_runtime) and INTEGRATION_OWNER_URL
 * (owner, for fixtures and operator actions as control_app) are set -- the CI
 * isolation job sets both. Skipped otherwise.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const runtimeUrl = process.env.INTEGRATION_DATABASE_URL;
const ownerUrl = process.env.INTEGRATION_OWNER_URL;

describe.skipIf(!runtimeUrl || !ownerUrl)('native auth lifecycle (real database)', () => {
  let owner: pg.Client;
  let auth: typeof import('@/lib/auth');
  const orgA = randomUUID();
  const orgB = randomUUID();
  const email = `staff-${randomBytes(4).toString('hex')}@example.test`;
  let userId = '';
  let password = 'initial-horse-battery';

  async function asControl<T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
    await owner.query('BEGIN');
    try {
      await owner.query('SET LOCAL ROLE control_app');
      const result = await owner.query<T>(text, values);
      await owner.query('COMMIT');
      return result.rows;
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  }

  async function login(organizationId: string, totpToken?: string) {
    return auth.loginWithPassword({ email, password, organizationId, totpToken });
  }

  async function tokenFor(organizationId: string): Promise<string> {
    const result = await login(organizationId);
    if (!result.ok) throw new Error(`login failed: ${result.reason}`);
    return result.value.token;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = runtimeUrl;
    process.env.JBOX_ENVIRONMENT = process.env.JBOX_ENVIRONMENT ?? 'ci';
    process.env.FIELD_AUTH_SECRET = 'i'.repeat(48);
    process.env.FIELD_AUTH_KEY_VERSION = 'v1';
    auth = await import('@/lib/auth');

    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query(
      `INSERT INTO organizations (id, slug, display_name, status) VALUES
         ($1, $3, 'Integration A', 'active'), ($2, $4, 'Integration B', 'active')`,
      [orgA, orgB, `int-a-${orgA.slice(0, 8)}`, `int-b-${orgB.slice(0, 8)}`],
    );

    const initialToken = randomBytes(32).toString('base64url');
    const provisioned = await asControl<{ platform_user_id: string }>(
      'SELECT * FROM control_staff_provision($1, $2, $3, $4, $5, $6, $7)',
      ['operator:integration', orgA, email, 'Integration Staff', 'owner', auth.hashResetToken(initialToken), 3600],
    );
    userId = provisioned[0].platform_user_id;
    expect(await auth.resetPasswordWithToken({ token: initialToken, newPassword: password })).toEqual({ ok: true });
    expect((await auth.resetPasswordWithToken({ token: initialToken, newPassword: 'another-horse-battery' })).ok).toBe(false);

    // Provisioning the same login into a second organization reuses the
    // identity and leaves its credential alone.
    await asControl('SELECT * FROM control_staff_provision($1, $2, $3, $4, $5, $6, $7)',
      ['operator:integration', orgB, email, 'ignored', 'technician', null, null]);
  });

  afterAll(async () => {
    await owner?.end();
    const { closeDatabasePool } = await import('@/lib/db');
    await closeDatabasePool();
  });

  it('signs in per organization; a token never resolves against another organization', async () => {
    const token = await tokenFor(orgA);
    const staff = await auth.resolveStaffFromToken(token);
    expect(staff).toMatchObject({ platformUserId: userId, organizationId: orgA, role: 'owner' });

    const tokenB = await tokenFor(orgB);
    expect((await auth.resolveStaffFromToken(tokenB))?.role).toBe('technician');
    expect(staff?.membershipId).not.toBe((await auth.resolveStaffFromToken(tokenB))?.membershipId);
  });

  it('answers wrong passwords and unknown emails identically, and locks after ten failures', async () => {
    const unknown = await auth.loginWithPassword({ email: 'nobody@example.test', password, organizationId: orgA });
    const wrong = await auth.loginWithPassword({ email, password: 'not-the-password', organizationId: orgA });
    expect(unknown).toEqual(wrong);

    for (let i = 0; i < 10; i += 1) {
      await auth.loginWithPassword({ email, password: 'still-wrong-password', organizationId: orgA });
    }
    expect(await login(orgA)).toEqual({ ok: false, reason: 'invalid-credentials' });
    await owner.query('UPDATE platform_users SET locked_until = NULL, failed_login_count = 0 WHERE id = $1', [userId]);
    expect((await login(orgA)).ok).toBe(true);
  });

  it('suspend -> reactivate never revives a token', async () => {
    const token = await tokenFor(orgA);
    await asControl('SELECT control_identity_set_status($1, $2, $3, $4)', ['operator:integration', userId, 'suspended', 'integration test']);
    expect(await auth.resolveStaffFromToken(token)).toBeNull();
    await asControl('SELECT control_identity_set_status($1, $2, $3, $4)', ['operator:integration', userId, 'active', 'integration test']);
    expect(await auth.resolveStaffFromToken(token)).toBeNull();
    expect((await login(orgA)).ok).toBe(true);
  });

  it('membership revoke -> re-provision never revives a token; the other org is untouched', async () => {
    const tokenA = await tokenFor(orgA);
    const tokenB = await tokenFor(orgB);
    await asControl('SELECT control_staff_revoke($1, $2, $3)', ['operator:integration', orgA, userId]);
    await asControl('SELECT * FROM control_staff_provision($1, $2, $3, $4, $5, $6, $7)',
      ['operator:integration', orgA, email, '', 'owner', null, null]);
    expect(await auth.resolveStaffFromToken(tokenA)).toBeNull();
    expect(await auth.resolveStaffFromToken(tokenB)).not.toBeNull();
  });

  it('a role change forces re-login, even with concurrent logins in flight', async () => {
    const before = await tokenFor(orgA);
    const [, ...concurrent] = await Promise.all([
      asControl('SELECT control_staff_set_role($1, $2, $3, $4)', ['operator:integration', orgA, userId, 'office']),
      login(orgA), login(orgA), login(orgA), login(orgA),
    ]);
    expect(await auth.resolveStaffFromToken(before)).toBeNull();
    // Whatever interleaving happened, every token that still resolves carries
    // the role that is current now -- none carries the old role.
    for (const result of concurrent) {
      if (!result.ok) continue;
      const staff = await auth.resolveStaffFromToken(result.value.token);
      if (staff) expect(staff.role).toBe('office');
    }
  });

  it('MFA: enrollment revokes password-only sessions, codes are single-use, the secret cannot be replaced', async () => {
    const token = await tokenFor(orgA);
    const setup = await auth.initiateMfaEnrollment(userId, email);
    if (!setup.ok) throw new Error('enrollment did not start');
    const code = generateSync({ secret: setup.value.secret });
    expect(await auth.completeMfaEnrollment(userId, orgA, code)).toEqual({ ok: true });
    expect(await auth.resolveStaffFromToken(token)).toBeNull();

    // The code used to enroll cannot be replayed to sign in.
    expect(await login(orgA)).toMatchObject({ ok: false, reason: 'mfa-required' });
    expect(await login(orgA, code)).toEqual({ ok: false, reason: 'invalid-credentials' });

    // A session in org B (no MFA) cannot swap the authenticator protecting A.
    expect(await auth.initiateMfaEnrollment(userId, email)).toEqual({ ok: false, reason: 'already-enrolled' });

    // Clean up for later tests: disable with a fresh step.
    await owner.query('UPDATE platform_users SET totp_last_step = totp_last_step - 10 WHERE id = $1', [userId]);
    const fresh = generateSync({ secret: setup.value.secret, epoch: Math.floor(Date.now() / 1000) + 30 });
    expect(await login(orgA, fresh)).toMatchObject({ ok: true });
  });

  it('a password change revokes every session and the new password works', async () => {
    await owner.query(
      'UPDATE organization_memberships SET mfa_required = false WHERE platform_user_id = $1', [userId]);
    const token = await tokenFor(orgB);
    const next = 'rotated-horse-battery';
    expect(await auth.changePassword({ email, currentPassword: password, newPassword: next })).toEqual({ ok: true });
    expect(await auth.resolveStaffFromToken(token)).toBeNull();
    password = next;
    expect((await login(orgB)).ok).toBe(true);
  });
});
