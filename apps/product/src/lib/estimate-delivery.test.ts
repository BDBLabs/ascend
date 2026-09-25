import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigV1 } from '@contractor-platform/configuration';
import type { EstimateRecord } from '@/lib/estimates';

const mocks = vi.hoisted(() => ({
  requireOrganizationContext: vi.fn(),
  getEstimate: vi.fn(),
  loadInForceConfig: vi.fn(),
  customerAccessTokensConfigured: vi.fn(),
  dbQuery: vi.fn(),
}));

vi.mock('@/lib/organization-context-store', () => ({
  requireOrganizationContext: () => mocks.requireOrganizationContext(),
}));
vi.mock('@/lib/estimates', () => ({
  getEstimate: (...args: unknown[]) => mocks.getEstimate(...args),
}));
vi.mock('@/lib/tenant', () => ({
  loadInForceConfig: (...args: unknown[]) => mocks.loadInForceConfig(...args),
}));
vi.mock('@/lib/customer-access-tokens', () => ({
  customerAccessTokensConfigured: () => mocks.customerAccessTokensConfigured(),
  customerAccessTokenKeyVersion: () => 'v1',
  deriveCustomerAccessToken: (scope: { purpose: string; resourceVersionId: string }) =>
    `token-${scope.purpose.split('.')[1]}-${scope.resourceVersionId.slice(0, 8)}`,
  hashCustomerAccessToken: (token: string) => `hash-of-${token}`,
}));
vi.mock('@/lib/estimate-evidence', () => ({
  draftContentHash: () => 'c'.repeat(64),
}));
vi.mock('@/lib/db', () => ({
  db: () => ({ query: mocks.dbQuery }),
}));

import { createEstimateDelivery } from '@/lib/estimate-delivery';

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';

const ESTIMATE = {
  id: '11111111-1111-4111-8111-111111111111',
  displayId: 'EST-0001',
  customerId: '33333333-3333-4333-8333-333333333333',
  status: 'draft',
  title: 'Drain & sewer line',
  customer: {
    email: 'customer@example.com',
    name: 'Patricia O\u2019Neill',
    phone: '',
    address: '',
    town: '',
    project: '',
  },
  lineItems: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} as unknown as EstimateRecord;

const CONFIG = {
  version: 'v1',
  identity: { businessName: 'Paris Electric', tagline: '' },
  contact: { phone: '', email: 'hello@paris.useascend.com', address: '', hours: '' },
} as unknown as ConfigV1;

const CONTEXT = { organizationId: ORGANIZATION_ID, actorId: 'actor-1', requestId: 'req-1' };


beforeEach(() => {
  mocks.requireOrganizationContext.mockReturnValue(CONTEXT);
  mocks.getEstimate.mockResolvedValue(ESTIMATE);
  mocks.loadInForceConfig.mockResolvedValue(CONFIG);
  mocks.customerAccessTokensConfigured.mockReturnValue(true);
  mocks.dbQuery.mockResolvedValue([{ hostname: 'paris.useascend.com' }]);
  process.env.RESEND_API_KEY = 're_test_abcdefghijkl';
});

describe('createEstimateDelivery gating', () => {
  it('returns estimate-not-found when the estimate is missing', async () => {
    mocks.getEstimate.mockResolvedValue(null);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('estimate-not-found');
  });

  it('returns estimate-not-draft unless the estimate is a draft', async () => {
    mocks.getEstimate.mockResolvedValue({ ...ESTIMATE, status: 'signed' } as EstimateRecord);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('estimate-not-draft');
  });

  it('returns customer-email-missing without a usable recipient', async () => {
    mocks.getEstimate.mockResolvedValue({
      ...ESTIMATE,
      customer: { ...ESTIMATE.customer, email: '' },
    } as EstimateRecord);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('customer-email-missing');
  });

  it('returns delivery-not-configured when the tenant has no config', async () => {
    mocks.loadInForceConfig.mockResolvedValue(null);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('delivery-not-configured');
  });

  it('returns delivery-not-configured when Resend is not usable', async () => {
    delete process.env.RESEND_API_KEY;
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('delivery-not-configured');
    expect(mocks.dbQuery.mock.calls.some(([sql]) => String(sql).includes('create_estimate_delivery'))).toBe(false);
  });

  it('returns link-tokens-not-configured when access tokens are unset', async () => {
    mocks.customerAccessTokensConfigured.mockReturnValue(false);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('link-tokens-not-configured');
  });

  it('returns tenant-host-not-found without a verified canonical domain', async () => {
    mocks.dbQuery.mockResolvedValue([]);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('tenant-host-not-found');
  });
});

describe('createEstimateDelivery (one transaction)', () => {
  function deliveryCall() {
    return mocks.dbQuery.mock.calls.find(([sql]) => String(sql).includes('create_estimate_delivery')) as
      [string, unknown[]] | undefined;
  }

  it('issues both grants, the delivery and the outbox message in ONE database call', async () => {
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(true);

    const call = deliveryCall();
    expect(call).toBeDefined();
    const [, params] = call!;
    const [deliveryId, estimateId, expectedUpdatedAt, contentHash, recipient, customerId,
      viewGrantId, viewHash, signGrantId, signHash, keyVersion, , createdBy, payloadJson] = params as string[];
    expect(deliveryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(estimateId).toBe(ESTIMATE.id);
    expect(expectedUpdatedAt).toBe(ESTIMATE.updatedAt);
    expect(contentHash).toBe('c'.repeat(64));
    expect(recipient).toBe('customer@example.com');
    expect(customerId).toBe(ESTIMATE.customerId);
    expect(viewGrantId).not.toBe(signGrantId);
    // Only token HASHES reach the database.
    expect(viewHash).toBe('hash-of-token-view-cccccccc');
    expect(signHash).toBe('hash-of-token-sign-cccccccc');
    expect(keyVersion).toBe('v1');
    expect(createdBy).toBe('actor-1');

    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    expect(payload).toMatchObject({
      displayId: 'EST-0001',
      customerEmail: 'customer@example.com',
      from: 'hello@paris.useascend.com',
      companyName: 'Paris Electric',
      // Links are bound to the draft content hash.
      viewUrl: 'https://paris.useascend.com/estimates/token-view-cccccccc',
      approveUrl: 'https://paris.useascend.com/estimates/token-sign-cccccccc?intent=approve',
      declineUrl: 'https://paris.useascend.com/estimates/token-sign-cccccccc?intent=decline',
    });
    if (result.ok) expect(result.delivery.status).toBe('queued');
  });

  it('has no compensating cleanup path: a failure is one rolled-back transaction', async () => {
    mocks.dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('create_estimate_delivery')) throw new Error('queue down');
      return [{ hostname: 'paris.useascend.com' }];
    });
    await expect(createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' })).rejects.toThrow('queue down');
    expect(mocks.dbQuery.mock.calls.filter(([sql]) => String(sql).includes("'revoked'"))).toHaveLength(0);
  });

  it('reports an estimate edited mid-send as estimate-changed', async () => {
    mocks.dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('create_estimate_delivery')) throw new Error('estimate_changed: the estimate is no longer the draft being sent');
      return [{ hostname: 'paris.useascend.com' }];
    });
    expect(await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' }))
      .toEqual({ ok: false, reason: 'estimate-changed' });
  });
});
