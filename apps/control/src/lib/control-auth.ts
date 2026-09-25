import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Control-plane caller identity (P5: per-operator identity and audit).
 *
 * Two kinds of caller, both `Authorization: Bearer <token>`:
 *
 *   operator  A named human operator. CONTROL_OPERATORS_JSON lists
 *             [{ "id": "alice@bdblabs.com", "tokenSha256": "<hex>" }] --
 *             only the SHA-256 of each token is configured, so the environment
 *             never holds a usable operator credential. Every mutation is
 *             audited with the operator id (identity_audit_events).
 *
 *   service   The product app's self-serve onboarding, authenticated by
 *             CONTROL_API_TOKEN. It may only provision a tenant (which lands in
 *             'provisioning' state) and check slug availability; every other
 *             route is operator-only.
 *
 * Comparisons hash both sides first and are timing-safe.
 */

export type ControlCaller = { kind: 'operator' | 'service'; id: string };

type OperatorEntry = { id: string; tokenSha256: string };

const SERVICE_ID = 'service:product-onboarding';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function operators(): OperatorEntry[] {
  const raw = process.env.CONTROL_OPERATORS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is OperatorEntry => (
      typeof entry === 'object' && entry !== null
      && typeof (entry as OperatorEntry).id === 'string'
      && /^[^\s:]{3,120}$/.test((entry as OperatorEntry).id)
      && typeof (entry as OperatorEntry).tokenSha256 === 'string'
      && /^[a-f0-9]{64}$/.test((entry as OperatorEntry).tokenSha256)
    ));
  } catch {
    return [];
  }
}

function bearer(header: string | null): string | null {
  const match = /^Bearer (\S{16,512})$/.exec(header ?? '');
  return match ? match[1] : null;
}

export function authenticateControlCaller(authorizationHeader: string | null): ControlCaller | null {
  const token = bearer(authorizationHeader);
  if (!token) return null;
  const supplied = sha256(token);

  let found: ControlCaller | null = null;
  // Compare against every entry (no early exit) so timing does not reveal
  // which entry, if any, matched.
  for (const operator of operators()) {
    if (timingSafeEqual(supplied, Buffer.from(operator.tokenSha256, 'hex'))) {
      found = { kind: 'operator', id: `operator:${operator.id}` };
    }
  }
  const serviceToken = process.env.CONTROL_API_TOKEN ?? '';
  if (serviceToken.length >= 16 && timingSafeEqual(supplied, sha256(serviceToken)) && !found) {
    found = { kind: 'service', id: SERVICE_ID };
  }
  return found;
}

export type ControlAuthorization = { caller: ControlCaller } | { response: Response };

/**
 * Route guard. Operator-only unless `allowService` is set for the two routes
 * the onboarding service needs.
 */
export function authorizeControl(
  request: Request,
  options: { allowService?: boolean } = {},
): ControlAuthorization {
  const caller = authenticateControlCaller(request.headers.get('authorization'));
  if (!caller) return { response: Response.json({ error: 'unauthorized' }, { status: 401 }) };
  if (caller.kind === 'service' && !options.allowService) {
    return { response: Response.json({ error: 'operator identity required' }, { status: 403 }) };
  }
  return { caller };
}
