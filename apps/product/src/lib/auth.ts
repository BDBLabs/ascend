import 'server-only';

import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { NextResponse } from 'next/server';
import type { ApplicationRole } from '@contractor-platform/domain';
import { capabilitiesForRole } from '@contractor-platform/domain';
import { platformDb } from '@/lib/db';
import { fieldAuthSecret, fieldAuthSecrets, fieldAuthTokenMinutes } from '@/lib/identity-environment';
import { verifyTotpStep, generateTotpSecret, getTotpUri, type LoginResult, type AuthenticatedStaff } from '@/lib/mfa';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * First-party Field authentication. Ports TrueTraining's auth-service pattern
 * (JWT with tenant + role claims, jti-keyed revocation, role-change revocation)
 * onto the jbox identity store:
 *
 *   - platform_users.password_hash is the credential (scrypt, not bcrypt: the
 *     same KDF discipline, built into Node, no native dependency).
 *   - field_sessions is the active-session ledger. A token is valid only while
 *     its jti row exists, is not revoked or expired, and still carries the
 *     user's and membership's current auth versions (migration 035); logout
 *     revokes it; any credential/status/role/MFA change revokes the affected
 *     sessions in the same transaction.
 *   - Every verification re-reads the live membership, so a role change takes
 *     effect on the next request even before explicit revocation (TrueTraining's
 *     /me re-reads the DB for the same reason).
 *
 * Auth is cross-tenant by construction: login and verification run on
 * platformDb() with no tenant context, through the SECURITY DEFINER windows from
 * migration 007. The tenant boundary is enforced by the membership RLS, not by
 * the token.
 */

export const FIELD_SESSION_COOKIE = 'field_session';
export const FIELD_TOKEN_ISSUER = 'usejbox:field';
export const FIELD_TOKEN_AUDIENCE = 'usejbox:field';

// Password policy (P2.3). New passwords: 12-256 characters, not the email or
// its local part, not a well-known password. Any submitted password over
// MAX_PASSWORD_INPUT_LENGTH is refused before hashing, so an oversized input
// cannot be used to burn CPU in scrypt.
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;
export const MAX_PASSWORD_INPUT_LENGTH = 1024;
const COMMON_PASSWORDS = new Set([
  'password1234', 'passwordpassword', '123456789012', 'qwertyuiopas', 'letmeinletmein',
  'iloveyou1234', 'welcome12345', 'administrator', 'changeme1234', 'password12345',
]);

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: string };

export function checkNewPassword(password: string, email?: string): PasswordPolicyResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: `Password must be at most ${MAX_PASSWORD_LENGTH} characters long.` };
  }
  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered) || /^(.)\1+$/.test(password)) {
    return { ok: false, reason: 'Password is too common.' };
  }
  if (email) {
    const address = email.trim().toLowerCase();
    const local = address.split('@')[0] ?? '';
    if (lowered === address || (local.length >= 4 && lowered.includes(local))) {
      return { ok: false, reason: 'Password must not contain your email address.' };
    }
  }
  return { ok: true };
}

// Current scrypt parameters. Stored hashes record their own parameters, so
// these can be raised later: verification accepts any hash within the bounds
// below, and a successful login transparently rehashes (needsRehash).
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT_LENGTH = 16;

// Verified against when no credential exists, so an unknown email costs the
// same scrypt work as a wrong password (no timing enumeration).
const TIMING_DECOY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

export async function hashPassword(password: string, email?: string): Promise<string> {
  const policy = checkNewPassword(password, email);
  if (!policy.ok) throw new Error(policy.reason);
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const key = await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return formatScryptHash(key, salt);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_INPUT_LENGTH) return false;
  const parsed = parseScryptHash(stored);
  if (!parsed) return false;
  const candidate = await deriveKey(password, parsed.salt, parsed.n, parsed.r, parsed.p);
  const storedKey = Buffer.from(parsed.key, 'base64url');
  if (candidate.length !== storedKey.length) return false;
  return timingSafeEqual(candidate, storedKey);
}

/** True when a valid stored hash uses parameters other than the current ones. */
export function needsRehash(stored: string): boolean {
  const parsed = parseScryptHash(stored);
  return Boolean(parsed && (parsed.n !== SCRYPT_N || parsed.r !== SCRYPT_R || parsed.p !== SCRYPT_P));
}

async function deriveKey(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return Buffer.from(await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: n, r, p, maxmem: 256 * n * r * 2,
  }));
}

function formatScryptHash(key: Buffer, salt: Buffer): string {
  return [
    'scrypt',
    SCRYPT_N, SCRYPT_R, SCRYPT_P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

function parseScryptHash(stored: string): { salt: Buffer; key: string; n: number; r: number; p: number } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  // Bounds keep a tampered hash from requesting absurd work.
  if (
    !Number.isInteger(n) || n < 16384 || n > 131072 || (n & (n - 1)) !== 0
    || !Number.isInteger(r) || r < 8 || r > 16
    || !Number.isInteger(p) || p < 1 || p > 4
  ) {
    return null;
  }
  try {
    return { salt: Buffer.from(parts[4], 'base64url'), key: parts[5], n, r, p };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// JWT issue / verify
// ---------------------------------------------------------------------------

export type FieldTokenClaims = {
  sub: string;
  email: string;
  organization_id: string;
  role: ApplicationRole;
  jti: string;
  iat: number;
  exp: number;
};

async function tokenSigningKey(secret: string): Promise<Uint8Array> {
  // HS256 requires a key of at least 32 bytes. The config check enforces the
  // length; deriving a fixed-width key here keeps the guard in one place even
  // for secrets longer than the minimum.
  return createHash('sha256').update(secret).digest();
}

export async function signFieldToken(claims: Omit<FieldTokenClaims, 'iat' | 'exp'>): Promise<string> {
  const secret = fieldAuthSecret();
  if (!secret) throw new Error('field_auth_not_configured');
  const ttlMinutes = fieldAuthTokenMinutes();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: claims.email,
    organization_id: claims.organization_id,
    role: claims.role,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(FIELD_TOKEN_ISSUER)
    .setAudience(FIELD_TOKEN_AUDIENCE)
    .setJti(claims.jti)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlMinutes * 60)
    .sign(await tokenSigningKey(secret));
}

export async function verifyFieldToken(
  token: string,
): Promise<{ claims: FieldTokenClaims } | null> {
  const secrets = fieldAuthSecrets();
  if (secrets.length === 0) return null;

  for (const secret of secrets) {
    try {
      const { payload } = await jwtVerify(token, await tokenSigningKey(secret), {
        issuer: FIELD_TOKEN_ISSUER,
        audience: FIELD_TOKEN_AUDIENCE,
      });
      const { sub, email, organization_id: organizationId, role, jti } = payload;
      if (
        typeof sub !== 'string'
        || typeof email !== 'string'
        || typeof organizationId !== 'string'
        || typeof role !== 'string'
        || typeof jti !== 'string'
        || typeof payload.iat !== 'number'
        || typeof payload.exp !== 'number'
      ) {
        continue;
      }
      if (role !== 'owner' && role !== 'office' && role !== 'technician') continue;
      return {
        claims: {
          sub, email, organization_id: organizationId, role, jti,
          iat: payload.iat, exp: payload.exp,
        },
      };
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session ledger (migration 035)
// ---------------------------------------------------------------------------
//
// Sessions are issued, validated and revoked only through SECURITY DEFINER
// windows. Each session records the user's and membership's auth_version at
// issue; any credential/status/role/MFA change bumps a version (and revokes the
// affected sessions) in the same transaction, so no token survives -- or is
// revived by -- a later reactivation.

function newJti(): string {
  return randomBytes(24).toString('base64url');
}

type LoginCredentialRow = {
  platform_user_id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  membership_id: string;
  role: ApplicationRole;
  mfa_required: boolean;
  totp_secret: string | null;
  locked: boolean;
};

/**
 * Authenticates email + password (+ TOTP where required) against an
 * organization and issues a session.
 *
 * Enumeration-safe: an unknown email, a wrong password, a locked account and a
 * wrong/replayed TOTP code all return 'invalid-credentials', and every path
 * performs the same scrypt work. Failures count toward the deployment-wide
 * lockout (10 consecutive failures lock the account for 15 minutes).
 */
export async function loginWithPassword(options: {
  email: string;
  password: string;
  organizationId: string;
  totpToken?: string;
}): Promise<LoginResult> {
  const email = options.email.trim().toLowerCase();
  if (!email || !options.password || !options.organizationId
      || options.password.length > MAX_PASSWORD_INPUT_LENGTH) {
    return { ok: false, reason: 'invalid-credentials' };
  }

  const rows = (await platformDb().query(
    `SELECT platform_user_id, email, display_name, password_hash,
            membership_id, role, mfa_required, totp_secret, locked
       FROM staff_login_lookup($1::text, $2::uuid)`,
    [email, options.organizationId],
  )) as LoginCredentialRow[];
  const credential = rows[0];

  const passwordOk = await verifyPassword(options.password, credential?.password_hash ?? TIMING_DECOY_HASH);
  if (!credential || !credential.password_hash || !passwordOk || credential.locked) {
    await platformDb().query('SELECT staff_login_failure($1::text)', [email]);
    return { ok: false, reason: 'invalid-credentials' };
  }

  if (credential.mfa_required) {
    if (!options.totpToken) {
      return {
        ok: false,
        reason: 'mfa-required',
        mfa: {
          userId: credential.platform_user_id,
          email: credential.email,
          organizationId: options.organizationId,
          membershipId: credential.membership_id,
          role: credential.role,
          displayName: credential.display_name,
        },
      };
    }
    const step = credential.totp_secret ? verifyTotpStep(options.totpToken, credential.totp_secret) : null;
    const fresh = step !== null && await consumeTotpStep(credential.platform_user_id, step);
    if (!fresh) {
      await platformDb().query('SELECT staff_login_failure($1::text)', [email]);
      return { ok: false, reason: 'invalid-credentials' };
    }
  }

  await platformDb().query('SELECT staff_login_success($1::uuid)', [credential.platform_user_id]);

  // Transparent upgrade to current scrypt parameters. Does not revoke sessions.
  if (needsRehash(credential.password_hash)) {
    await platformDb().query(
      'SELECT staff_password_rehash($1::uuid, $2::text, $3::text)',
      [credential.platform_user_id, credential.password_hash, await rehashPassword(options.password)],
    );
  }

  const jti = newJti();
  const ttlMinutes = fieldAuthTokenMinutes();
  const issued = (await platformDb().query(
    'SELECT membership_id, expires_at FROM staff_session_issue($1::text, $2::uuid, $3::uuid, $4::integer)',
    [jti, credential.platform_user_id, options.organizationId, ttlMinutes * 60],
  )) as Array<{ membership_id: string; expires_at: string | Date }>;
  if (!issued[0]) return { ok: false, reason: 'invalid-credentials' };

  const token = await signFieldToken({
    sub: credential.platform_user_id,
    email: credential.email,
    organization_id: options.organizationId,
    role: credential.role,
    jti,
  });

  return {
    ok: true,
    value: {
      token,
      expiresAt: new Date(issued[0].expires_at).toISOString(),
      staff: {
        platformUserId: credential.platform_user_id,
        email: credential.email,
        displayName: credential.display_name,
        organizationId: options.organizationId,
        membershipId: issued[0].membership_id,
        role: credential.role,
        mfaRequired: credential.mfa_required,
      },
    },
  };
}

/** Hashes with current parameters for a rehash (the policy applied at set time). */
async function rehashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  return formatScryptHash(await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P), salt);
}

/**
 * Resolves a session token to a live principal, or null. Fails closed:
 * unverifiable signature, expired token, a revoked/missing session, a changed
 * user or membership version, or anything no longer active all yield null. The
 * role is the live membership role.
 */
export async function resolveStaffFromToken(
  token: string,
): Promise<AuthenticatedStaff | null> {
  const verified = await verifyFieldToken(token);
  if (!verified) return null;
  const { claims } = verified;

  const rows = (await platformDb().query(
    `SELECT membership_id, role, mfa_required, display_name, email
       FROM staff_session_validate($1::text, $2::uuid, $3::uuid)`,
    [claims.jti, claims.sub, claims.organization_id],
  )) as Array<{ membership_id: string; role: ApplicationRole; mfa_required: boolean; display_name: string; email: string }>;
  const session = rows[0];
  if (!session) return null;

  return {
    platformUserId: claims.sub,
    email: session.email,
    displayName: session.display_name,
    organizationId: claims.organization_id,
    membershipId: session.membership_id,
    role: session.role,
    mfaRequired: session.mfa_required,
  };
}

/** Revokes the session for the given token (logout). No-ops on unknown tokens. */
export async function revokeFieldSession(token: string): Promise<void> {
  const verified = await verifyFieldToken(token);
  if (!verified) return;
  await platformDb().query('SELECT staff_session_revoke($1::text)', [verified.claims.jti]);
}

/** Revokes every active session for a staff member. */
export async function revokeAllSessionsForStaff(platformUserId: string): Promise<void> {
  await platformDb().query(
    'SELECT revoke_field_sessions_for_user($1::uuid)',
    [platformUserId],
  );
}

export type StaffMembershipOption = {
  organizationId: string;
  organizationName: string;
  membershipId: string;
  role: ApplicationRole;
  displayName: string;
  email: string;
};

/**
 * Active organizations for an email. Only called AFTER the password was
 * verified (login route), so the choices are never shown to an unauthenticated
 * caller.
 */
export async function listActiveMembershipsForEmail(
  email: string,
): Promise<StaffMembershipOption[]> {
  const rows = (await platformDb().query(
    `SELECT organization_id, organization_name, membership_id, role, mfa_required, display_name, email
       FROM staff_memberships_for_email($1::text)`,
    [email.trim().toLowerCase()],
  )) as Array<{
    organization_id: string;
    organization_name: string;
    membership_id: string;
    role: ApplicationRole;
    mfa_required: boolean;
    display_name: string;
    email: string;
  }>;
  return rows.map((row) => ({
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    membershipId: row.membership_id,
    role: row.role,
    displayName: row.display_name,
    email: row.email,
  }));
}

/**
 * Verifies the global credential for an email (used before listing a
 * multi-organization login's choices, and for re-authentication). Same
 * enumeration and lockout behaviour as loginWithPassword.
 */
export async function verifyUserGlobalPassword(
  email: string,
  password: string,
): Promise<{ ok: true; platformUserId: string; passwordHash: string } | { ok: false }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password || password.length > MAX_PASSWORD_INPUT_LENGTH) return { ok: false };

  const rows = (await platformDb().query(
    'SELECT platform_user_id, password_hash FROM staff_user_credential_lookup($1::text)',
    [normalizedEmail],
  )) as Array<{ platform_user_id: string; password_hash: string | null }>;
  const user = rows[0];

  const valid = await verifyPassword(password, user?.password_hash ?? TIMING_DECOY_HASH);
  if (!user || !user.password_hash || !valid) {
    await platformDb().query('SELECT staff_login_failure($1::text)', [normalizedEmail]);
    return { ok: false };
  }
  return { ok: true, platformUserId: user.platform_user_id, passwordHash: user.password_hash };
}

// ---------------------------------------------------------------------------
// Password change and reset
// ---------------------------------------------------------------------------

export type PasswordChangeResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-credentials' | 'weak-password' | 'conflict'; detail?: string };

/**
 * Authenticated change: re-verifies the current password, applies the policy,
 * and swaps the hash compare-and-set. Every session (this one included) is
 * revoked by the version trigger, so the caller must sign in again.
 */
export async function changePassword(options: {
  email: string;
  currentPassword: string;
  newPassword: string;
}): Promise<PasswordChangeResult> {
  const current = await verifyUserGlobalPassword(options.email, options.currentPassword);
  if (!current.ok) return { ok: false, reason: 'invalid-credentials' };
  const policy = checkNewPassword(options.newPassword, options.email);
  if (!policy.ok) return { ok: false, reason: 'weak-password', detail: policy.reason };

  const rows = (await platformDb().query(
    'SELECT staff_password_change($1::uuid, $2::text, $3::text) AS changed',
    [current.platformUserId, current.passwordHash, await hashPassword(options.newPassword, options.email)],
  )) as Array<{ changed: boolean }>;
  return rows[0]?.changed ? { ok: true } : { ok: false, reason: 'conflict' };
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Consumes an operator-issued reset (or initial set-password) token. Unknown,
 * used and expired tokens are indistinguishable. Revokes every session.
 */
export async function resetPasswordWithToken(options: {
  token: string;
  newPassword: string;
}): Promise<{ ok: true } | { ok: false; reason: 'invalid-token' | 'weak-password'; detail?: string }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(options.token)) return { ok: false, reason: 'invalid-token' };
  const policy = checkNewPassword(options.newPassword);
  if (!policy.ok) return { ok: false, reason: 'weak-password', detail: policy.reason };

  const rows = (await platformDb().query(
    'SELECT staff_password_reset_consume($1::text, $2::text) AS platform_user_id',
    [hashResetToken(options.token), await hashPassword(options.newPassword)],
  )) as Array<{ platform_user_id: string | null }>;
  return rows[0]?.platform_user_id ? { ok: true } : { ok: false, reason: 'invalid-token' };
}

// ---------------------------------------------------------------------------
// MFA (TOTP)
// ---------------------------------------------------------------------------

type MfaState = { totp_secret: string | null; totp_pending_secret: string | null; totp_last_step: string | number | null };

async function readMfaState(platformUserId: string): Promise<MfaState | null> {
  const rows = (await platformDb().query(
    'SELECT totp_secret, totp_pending_secret, totp_last_step FROM staff_mfa_state($1::uuid)',
    [platformUserId],
  )) as MfaState[];
  return rows[0] ?? null;
}

async function consumeTotpStep(platformUserId: string, step: number): Promise<boolean> {
  const rows = (await platformDb().query(
    'SELECT staff_mfa_consume_step($1::uuid, $2::bigint) AS fresh',
    [platformUserId, step],
  )) as Array<{ fresh: boolean }>;
  return rows[0]?.fresh === true;
}

export type MfaSetupResult =
  | { ok: true; value: { secret: string; uri: string } }
  | { ok: false; reason: 'already-enrolled' };

/**
 * Starts enrollment with a PENDING secret. A user whose authenticator is
 * already active (MFA in another organization) gets 'already-enrolled' and
 * completes enrollment here with a code from that same authenticator -- the
 * active secret is never replaced by a new enrollment.
 */
export async function initiateMfaEnrollment(
  platformUserId: string,
  email: string,
): Promise<MfaSetupResult> {
  const secret = generateTotpSecret();
  try {
    await platformDb().query('SELECT staff_mfa_initiate($1::uuid, $2::text)', [platformUserId, secret]);
  } catch (error) {
    if (error instanceof Error && /totp_already_enrolled/.test(error.message)) {
      return { ok: false, reason: 'already-enrolled' };
    }
    throw error;
  }
  return { ok: true, value: { secret, uri: getTotpUri(email, secret) } };
}

/**
 * Completes enrollment for the current organization with a code from the
 * pending secret (or the already-active one). Revokes existing sessions: the
 * next sign-in to this organization requires a code.
 */
export async function completeMfaEnrollment(
  platformUserId: string,
  organizationId: string,
  totpToken: string,
): Promise<{ ok: boolean; reason?: string }> {
  const state = await readMfaState(platformUserId);
  const secret = state?.totp_secret ?? state?.totp_pending_secret ?? null;
  const step = secret ? verifyTotpStep(totpToken, secret) : null;
  if (step === null) return { ok: false, reason: 'invalid-token' };

  const rows = (await platformDb().query(
    'SELECT staff_mfa_complete($1::uuid, $2::uuid, $3::bigint) AS completed',
    [platformUserId, organizationId, step],
  )) as Array<{ completed: boolean }>;
  return rows[0]?.completed ? { ok: true } : { ok: false, reason: 'invalid-token' };
}

/** Disables MFA for one organization (the caller re-verified the password). */
export async function disableMfa(
  platformUserId: string,
  organizationId: string,
  totpToken: string,
): Promise<{ ok: boolean; reason?: string }> {
  const state = await readMfaState(platformUserId);
  const step = state?.totp_secret ? verifyTotpStep(totpToken, state.totp_secret) : null;
  if (step === null || !(await consumeTotpStep(platformUserId, step))) {
    return { ok: false, reason: 'invalid-token' };
  }
  await platformDb().query('SELECT staff_mfa_disable($1::uuid, $2::uuid)', [platformUserId, organizationId]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export function fieldSessionCookieOptions(): { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number } {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: fieldAuthTokenMinutes() * 60,
  };
}

/** Reads the session token from the server-component cookie store. */
export async function readFieldSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(FIELD_SESSION_COOKIE)?.value ?? null;
}

/** Convenience for the login/logout responses: a JSON body with the cookie set. */
export function fieldSessionResponse(
  body: unknown,
  token: string | null,
  status = 200,
): Response {
  const response = NextResponse.json(body, { status });
  if (token) {
    response.cookies.set(FIELD_SESSION_COOKIE, token, fieldSessionCookieOptions());
  } else {
    response.cookies.set(FIELD_SESSION_COOKIE, '', {
      ...fieldSessionCookieOptions(),
      maxAge: 0,
    });
  }
  return response;
}

/** Shared capability set for a resolved principal (kept in sync with identity). */
export function capabilitiesForStaffRole(role: ApplicationRole) {
  return capabilitiesForRole(role);
}
