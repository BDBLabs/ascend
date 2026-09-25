import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authenticateControlCaller, authorizeControl } from '@/lib/control-auth';

const SERVICE = 'service-token-for-tests-0000000000';
const ALICE = 'alice-operator-token-000000000000';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

function request(token?: string) {
  return new Request('https://control.test/api/organizations', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  process.env.CONTROL_API_TOKEN = SERVICE;
  process.env.CONTROL_OPERATORS_JSON = JSON.stringify([{ id: 'alice@bdblabs.com', tokenSha256: sha(ALICE) }]);
});

afterEach(() => {
  delete process.env.CONTROL_API_TOKEN;
  delete process.env.CONTROL_OPERATORS_JSON;
});

describe('authenticateControlCaller', () => {
  it('identifies a named operator by token hash', () => {
    expect(authenticateControlCaller(`Bearer ${ALICE}`)).toEqual({ kind: 'operator', id: 'operator:alice@bdblabs.com' });
  });

  it('identifies the onboarding service', () => {
    expect(authenticateControlCaller(`Bearer ${SERVICE}`)).toEqual({ kind: 'service', id: 'service:product-onboarding' });
  });

  it('rejects wrong, short, missing and malformed credentials', () => {
    expect(authenticateControlCaller('Bearer wrong-token-value-0000000000')).toBeNull();
    expect(authenticateControlCaller('Bearer short')).toBeNull();
    expect(authenticateControlCaller(null)).toBeNull();
    expect(authenticateControlCaller(ALICE)).toBeNull();
  });

  it('ignores malformed operator entries instead of failing open', () => {
    process.env.CONTROL_OPERATORS_JSON = JSON.stringify([{ id: 'x', tokenSha256: 'nothex' }, 'junk']);
    expect(authenticateControlCaller(`Bearer ${ALICE}`)).toBeNull();
    process.env.CONTROL_OPERATORS_JSON = '{not json';
    expect(authenticateControlCaller(`Bearer ${ALICE}`)).toBeNull();
  });
});

describe('authorizeControl', () => {
  it('refuses the service token on operator-only routes', async () => {
    const result = authorizeControl(request(SERVICE));
    expect('response' in result && result.response.status).toBe(403);
  });

  it('admits the service token where explicitly allowed', () => {
    expect(authorizeControl(request(SERVICE), { allowService: true })).toEqual({
      caller: { kind: 'service', id: 'service:product-onboarding' },
    });
  });

  it('answers 401 with no credential', () => {
    const result = authorizeControl(request());
    expect('response' in result && result.response.status).toBe(401);
  });
});
