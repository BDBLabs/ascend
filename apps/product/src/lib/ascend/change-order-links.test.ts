import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
}));

import {
  getProjectApprovedChangeValue,
  linkChangeOrderToProject,
  listProjectChangeOrders,
  unlinkChangeOrderFromProject,
} from './change-order-links';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const CO_UUID = '660e8400-e29b-41d4-a716-446655440001';

describe('linkChangeOrderToProject', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('links a same-customer change order', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: UUID, customer_id: UUID }])
      .mockResolvedValueOnce([{ id: CO_UUID, customer_id: UUID }])
      .mockResolvedValueOnce([]);

    const result = await linkChangeOrderToProject(CO_UUID, UUID);
    expect(result).toEqual({ ok: true, projectId: UUID, changeOrderId: CO_UUID });
    const insert = queryMock.mock.calls[2] as [string, unknown[]];
    expect(insert[0]).toContain('INSERT INTO project_change_orders');
  });

  it('rejects customer mismatches and missing rows', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: UUID, customer_id: UUID }])
      .mockResolvedValueOnce([{ id: CO_UUID, customer_id: 'other' }]);
    await expect(linkChangeOrderToProject(CO_UUID, UUID)).resolves.toEqual({
      ok: false,
      error: 'customer-mismatch',
    });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce([]);
    await expect(linkChangeOrderToProject(CO_UUID, UUID)).resolves.toEqual({
      ok: false,
      error: 'project-not-found',
    });
  });

  it('maps unique violations to already-linked', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: UUID, customer_id: UUID }])
      .mockResolvedValueOnce([{ id: CO_UUID, customer_id: UUID }])
      .mockRejectedValueOnce(new Error('duplicate key value violates unique'));
    const result = await linkChangeOrderToProject(CO_UUID, UUID);
    expect(result).toEqual({ ok: false, error: 'already-linked' });
  });
});

describe('unlinkChangeOrderFromProject', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('deletes the link when present', async () => {
    queryMock.mockResolvedValueOnce([{ id: 'link-1' }]);
    await expect(unlinkChangeOrderFromProject(UUID, CO_UUID)).resolves.toBe(true);
    queryMock.mockResolvedValueOnce([]);
    await expect(unlinkChangeOrderFromProject(UUID, CO_UUID)).resolves.toBe(false);
  });
});

describe('listProjectChangeOrders', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns linked orders with display fields', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: CO_UUID,
        display_id: 'CO-0001',
        title: 'Extra stop',
        status: 'approved',
        change_amount_cents: '150000',
      },
    ]);
    const rows = await listProjectChangeOrders(UUID);
    expect(rows).toEqual([
      {
        changeOrderId: CO_UUID,
        displayId: 'CO-0001',
        title: 'Extra stop',
        status: 'approved',
        changeAmountCents: 150000,
      },
    ]);
  });
});

describe('getProjectApprovedChangeValue', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('sums approved change value server-side', async () => {
    queryMock.mockResolvedValueOnce([{ total: '150000' }]);
    await expect(getProjectApprovedChangeValue(UUID)).resolves.toBe(150000);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("co.status = 'approved'");
    expect(params).toEqual([UUID]);
  });

  it('returns zero when nothing is linked', async () => {
    queryMock.mockResolvedValueOnce([{ total: '0' }]);
    await expect(getProjectApprovedChangeValue(UUID)).resolves.toBe(0);
  });
});

describe('listRecentChangeOrders', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('lists recent orders with customer names', async () => {
    const { listRecentChangeOrders } = await import('./change-order-links');
    queryMock.mockResolvedValueOnce([
      {
        id: CO_UUID,
        display_id: 'CO-0001',
        title: 'Extra stop',
        status: 'approved',
        change_amount_cents: 150000,
        customer_name: 'Acme',
      },
    ]);
    const rows = await listRecentChangeOrders(10);
    expect(rows).toEqual([
      {
        changeOrderId: CO_UUID,
        displayId: 'CO-0001',
        title: 'Extra stop',
        status: 'approved',
        changeAmountCents: 150000,
        customerName: 'Acme',
      },
    ]);
  });
});
