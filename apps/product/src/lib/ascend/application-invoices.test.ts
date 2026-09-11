import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
}));

vi.mock('@/lib/organization-context-store', () => ({
  requireOrganizationContext: () => ({ actorId: 'actor-1' }),
}));

vi.mock('@/lib/tenant', () => ({
  loadInForceConfig: async () => null,
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

const { progressBillingMock } = vi.hoisted(() => ({
  progressBillingMock: {
    application: null as null | Record<string, unknown>,
    linkResult: { ok: true as const },
  },
}));

vi.mock('./progress-billing', () => ({
  getApplication: async () => progressBillingMock.application,
  markApplicationInvoiced: async () => progressBillingMock.linkResult,
}));

import { createInvoiceForApplication } from './application-invoices';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

function approvedApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    billingPeriodId: 'period-1',
    periodNumber: 1,
    projectId: UUID,
    projectDisplayId: 'ASC-0001',
    invoiceId: null,
    status: 'approved',
    contractValueCents: 10000000,
    earnedValueCents: 1000000,
    previouslyBilledCents: 0,
    retainagePercent: 10,
    retainageCents: 100000,
    storedMaterialsCents: 0,
    currentDueCents: 900000,
    notes: '',
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

describe('createInvoiceForApplication', () => {
  beforeEach(() => {
    queryMock.mockReset();
    progressBillingMock.application = null;
    progressBillingMock.linkResult = { ok: true as const };
  });

  it('creates a draft invoice matching the frozen due, then links it', async () => {
    progressBillingMock.application = approvedApplication();
    queryMock
      .mockResolvedValueOnce([{ id: 'inv-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await createInvoiceForApplication('app-1');

    expect(result).toEqual({ ok: true, invoiceId: 'inv-1', reused: false });
    const insert = queryMock.mock.calls[0] as [string, unknown[]];
    expect(insert[0]).toContain('INSERT INTO invoices');
    expect(insert[0]).toContain("'draft'");
    const lines = queryMock.mock.calls[1] as [string, unknown[]];
    expect(lines[0]).toContain('INSERT INTO invoice_line_items');
    expect(lines[1]).toEqual(['inv-1', expect.stringContaining('ASC-0001'), 900000]);
    const events = queryMock.mock.calls[2] as [string, unknown[]];
    expect(events[0]).toContain("'created'");
  });

  it('reuses the existing invoice when already invoiced', async () => {
    progressBillingMock.application = approvedApplication({
      status: 'invoiced',
      invoiceId: 'inv-9',
    });
    const result = await createInvoiceForApplication('app-1');
    expect(result).toEqual({ ok: true, invoiceId: 'inv-9', reused: true });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('refuses drafts, missing applications, and zero-due approvals', async () => {
    progressBillingMock.application = approvedApplication({ status: 'submitted' });
    await expect(createInvoiceForApplication('app-1')).resolves.toEqual({
      ok: false,
      error: 'not-approved',
    });

    progressBillingMock.application = null;
    await expect(createInvoiceForApplication('missing')).resolves.toEqual({
      ok: false,
      error: 'application-not-found',
    });

    progressBillingMock.application = approvedApplication({ currentDueCents: 0 });
    await expect(createInvoiceForApplication('app-1')).resolves.toEqual({
      ok: false,
      error: 'nothing-due',
    });
  });
});
