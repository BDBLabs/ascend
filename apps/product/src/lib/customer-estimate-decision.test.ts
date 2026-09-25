import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: () => ({
    query: vi.fn().mockResolvedValue([{ id: 'grant-1', document_id: 'est-1' }]),
  }),
}));

vi.mock('@/lib/customer-access-grants', () => ({
  verifyCustomerAccessGrant: vi.fn().mockResolvedValue({
    ok: true,
    grant: { id: 'grant-1', resourceVersion: null, deliveryId: null },
  }),
}));

vi.mock('@/lib/estimates', () => ({
  getEstimate: vi.fn().mockResolvedValue({ id: 'est-1', status: 'draft' }),
  declineEstimate: vi.fn().mockResolvedValue({ ok: true, value: { id: 'est-1', status: 'declined' } }),
  signEstimate: vi.fn(),
}));

import { decideCustomerEstimate } from '@/lib/customer-estimate-decision';

// Valid customer-link token syntax: exactly 43 base64url chars, no separators.
const VALID_TOKEN = 'a'.repeat(43);

describe('decideCustomerEstimate validation', () => {
  it('rejects malformed token syntax', async () => {
    const result = await decideCustomerEstimate('invalid-token-format', {
      decision: 'approved',
      signerName: 'Jane Doe',
      affirmativeConsent: true,
    } as never);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects approval without affirmative consent', async () => {
    const result = await decideCustomerEstimate(VALID_TOKEN, {
      decision: 'approved',
      signerName: 'Jane Doe',
      affirmativeConsent: false,
    } as never);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it.each([true, false])(
    'accepts decline whether affirmativeConsent is %s',
    async (affirmativeConsent) => {
      const result = await decideCustomerEstimate(VALID_TOKEN, {
        decision: 'declined',
        signerName: '',
        affirmativeConsent,
      } as never);
      expect(result).toEqual({ ok: true, decision: 'declined', reused: false });
    },
  );
});
