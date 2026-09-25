import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platformQuery: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: mocks.platformQuery }),
  platformDb: () => ({ query: mocks.platformQuery }),
}));

import {
  checkNewPassword,
  hashPassword,
  loginWithPassword,
  needsRehash,
  resolveStaffFromToken,
  revokeAllSessionsForStaff,
  revokeFieldSession,
  signFieldToken,
  verifyPassword,
} from '@/lib/auth';
import { clearFieldAuthConfigCache } from '@/lib/identity-environment';

const SECRET = 'z'.repeat(48);
const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const MEMBERSHIP = '44444444-4444-4444-4444-444444444444';
const PASSWORD = 'correct-horse-battery';

type Row = Record<string, unknown>;

/**
 * A fake database keyed on the SQL window being called, so tests assert which
 * windows ran rather than the order of an array of canned results.
 */
function fakeDatabase(handlers: Record<string, (params: unknown[]) => Row[]>) {
  mocks.platformQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const name = Object.keys(handlers).find((key) => sql.includes(key));
    return name ? handlers[name](params) : [];
  });
}

function calls(fragment: string) {
  return mocks.platformQuery.mock.calls.filter(([sql]) => String(sql).includes(fragment));
}

async function credential(overrides: Row = {}): Promise<Row> {
  return {
    platform_user_id: USER,
    email: 'owner@example.com',
    display_name: 'Demo Owner',
    password_hash: await hashPassword(PASSWORD),
    membership_id: MEMBERSHIP,
    role: 'owner',
    mfa_required: false,
    totp_secret: null,
    locked: false,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.FIELD_AUTH_SECRET = SECRET;
  process.env.FIELD_AUTH_KEY_VERSION = 'v1';
  process.env.FIELD_AUTH_PREVIOUS_KEYS_JSON = '';
  process.env.NODE_ENV = 'test';
  clearFieldAuthConfigCache();
  mocks.platformQuery.mockReset();
});

describe('loginWithPassword — adversarial credential paths', () => {
  it('answers an unknown email exactly like a wrong password, after the same scrypt work', async () => {
    fakeDatabase({});
    const result = await loginWithPassword({ email: 'nobody@example.com', password: 'whatever-123', organizationId: ORG_A });
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(calls('staff_login_failure')).toHaveLength(1);
    expect(calls('staff_session_issue')).toHaveLength(0);
  });

  it('counts a wrong password toward the lockout', async () => {
    const row = await credential();
    fakeDatabase({ staff_login_lookup: () => [row] });
    const result = await loginWithPassword({ email: 'owner@example.com', password: 'wrong-password', organizationId: ORG_A });
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(calls('staff_login_failure')[0][1]).toEqual(['owner@example.com']);
  });

  it('refuses a locked account even with the right password, indistinguishably', async () => {
    const row = await credential({ locked: true });
    fakeDatabase({ staff_login_lookup: () => [row] });
    const result = await loginWithPassword({ email: 'owner@example.com', password: PASSWORD, organizationId: ORG_A });
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(calls('staff_session_issue')).toHaveLength(0);
  });

  it('refuses an oversized password before any database call or hashing', async () => {
    fakeDatabase({});
    const result = await loginWithPassword({ email: 'owner@example.com', password: 'x'.repeat(5000), organizationId: ORG_A });
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(mocks.platformQuery).not.toHaveBeenCalled();
  });

  it('issues the session through staff_session_issue, bound to the organization', async () => {
    const row = await credential();
    fakeDatabase({
      staff_login_lookup: () => [row],
      staff_session_issue: () => [{ membership_id: MEMBERSHIP, expires_at: new Date(Date.now() + 3600_000) }],
    });
    const result = await loginWithPassword({ email: 'owner@example.com', password: PASSWORD, organizationId: ORG_A });
    expect(result.ok).toBe(true);
    const [sql, params] = calls('staff_session_issue')[0] as [string, unknown[]];
    expect(sql).not.toContain('INSERT INTO field_sessions');
    const [jti, user, organization, ttl] = params as [string, string, string, number];
    expect(jti).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(user).toBe(USER);
    expect(organization).toBe(ORG_A);
    expect(ttl).toBeGreaterThan(0);
    expect(calls('staff_login_success')).toHaveLength(1);
  });

  it('fails closed when the window issues no session (membership went inactive mid-login)', async () => {
    const row = await credential();
    fakeDatabase({ staff_login_lookup: () => [row], staff_session_issue: () => [] });
    const result = await loginWithPassword({ email: 'owner@example.com', password: PASSWORD, organizationId: ORG_A });
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('each login issues a distinct jti', async () => {
    const row = await credential();
    fakeDatabase({
      staff_login_lookup: () => [row],
      staff_session_issue: () => [{ membership_id: MEMBERSHIP, expires_at: new Date(Date.now() + 3600_000) }],
    });
    await loginWithPassword({ email: 'owner@example.com', password: PASSWORD, organizationId: ORG_A });
    await loginWithPassword({ email: 'owner@example.com', password: PASSWORD, organizationId: ORG_A });
    const [first, second] = calls('staff_session_issue').map(([, params]) => (params as string[])[0]);
    expect(first).not.toBe(second);
  });

  it('challenges for MFA without issuing a session, and refuses a bad code', async () => {
    const row = await credential({ mfa_required: true, totp_secret: 'A'.repeat(32) });
    fakeDatabase({ staff_login_lookup: () => [row] });
    const challenge = await loginWithPassword({ email: 'owner@example.com', password: PASSWORD, organizationId: ORG_A });
    expect(challenge.ok === false && challenge.reason).toBe('mfa-required');
    const wrong = await loginWithPassword({ email: 'owner@example.com', password: PASSWORD, organizationId: ORG_A, totpToken: '000000' });
    expect(wrong).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(calls('staff_session_issue')).toHaveLength(0);
  });
});

describe('resolveStaffFromToken — adversarial session validation', () => {
  async function tokenFor(organizationId = ORG_A) {
    return signFieldToken({ sub: USER, email: 'owner@example.com', organization_id: organizationId, role: 'owner', jti: 'jti-adversarial-000001' });
  }

  it('validates only through staff_session_validate with jti, user and organization', async () => {
    fakeDatabase({
      staff_session_validate: () => [{ membership_id: MEMBERSHIP, role: 'office', mfa_required: false, display_name: 'D', email: 'owner@example.com' }],
    });
    const staff = await resolveStaffFromToken(await tokenFor());
    expect(staff?.role).toBe('office'); // live role, not the token claim
    const [sql, params] = mocks.platformQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('staff_session_validate($1::text, $2::uuid, $3::uuid)');
    expect(params).toEqual(['jti-adversarial-000001', USER, ORG_A]);
    expect(mocks.platformQuery).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the window returns nothing (revoked, expired, version changed, inactive)', async () => {
    fakeDatabase({});
    expect(await resolveStaffFromToken(await tokenFor())).toBeNull();
  });

  it('binds the lookup to the token organization (no cross-org substitution)', async () => {
    fakeDatabase({});
    await resolveStaffFromToken(await tokenFor(ORG_B));
    expect((mocks.platformQuery.mock.calls[0][1] as string[])[2]).toBe(ORG_B);
  });

  it('rejects a foreign-secret token before any database call', async () => {
    const token = await tokenFor();
    process.env.FIELD_AUTH_SECRET = 'q'.repeat(48);
    clearFieldAuthConfigCache();
    expect(await resolveStaffFromToken(token)).toBeNull();
    expect(mocks.platformQuery).not.toHaveBeenCalled();
  });
});

describe('logout', () => {
  it('revokes by jti through staff_session_revoke', async () => {
    fakeDatabase({});
    const token = await signFieldToken({ sub: USER, email: 'o@example.com', organization_id: ORG_A, role: 'owner', jti: 'jti-logout-0000000001' });
    await revokeFieldSession(token);
    expect(calls('staff_session_revoke')[0][1]).toEqual(['jti-logout-0000000001']);
  });

  it('revokeAllSessionsForStaff invokes the revoke window for the user', async () => {
    fakeDatabase({});
    await revokeAllSessionsForStaff(USER);
    expect(calls('revoke_field_sessions_for_user')[0][1]).toEqual([USER]);
  });
});

describe('password policy and hash upgrades', () => {
  it('enforces length, commonness and email containment for new passwords', () => {
    expect(checkNewPassword('short').ok).toBe(false);
    expect(checkNewPassword('x'.repeat(257)).ok).toBe(false);
    expect(checkNewPassword('password1234').ok).toBe(false);
    expect(checkNewPassword('aaaaaaaaaaaaaaaa').ok).toBe(false);
    expect(checkNewPassword('jordan-rivers-2026', 'jordan@example.com').ok).toBe(false);
    expect(checkNewPassword('correct-horse-battery', 'jordan@example.com').ok).toBe(true);
  });

  it('verifies hashes made with other bounded parameters and flags them for rehash', async () => {
    const current = await hashPassword(PASSWORD);
    expect(needsRehash(current)).toBe(false);
    const legacy = current.replace('scrypt$16384$', 'scrypt$32768$');
    expect(needsRehash(legacy)).toBe(true);
    expect(await verifyPassword(PASSWORD, 'scrypt$1048576$8$1$AAAA$AAAA')).toBe(false); // out of bounds
  });
});
