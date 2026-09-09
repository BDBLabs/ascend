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

import {
  createProjectPart,
  getProjectPart,
  listProjectParts,
  recordPartQuantity,
  updatePartStatus,
} from './project-parts';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

function partRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'part-1',
    project_id: UUID,
    project_display_id: 'ASC-0001',
    building_id: null,
    elevator_unit_id: null,
    elevator_unit_number: null,
    work_package_id: null,
    work_package_name: null,
    inventory_item_id: null,
    inventory_item_code: null,
    description: 'GAL controller, 12 stops',
    quantity_required_hundredths: 100,
    quantity_received_hundredths: 0,
    quantity_installed_hundredths: 0,
    status: 'specified',
    planned_cost_cents: 680000,
    actual_cost_cents: 0,
    supplier: 'GAL',
    source_ref: 'PO-101',
    needed_date: '2026-11-01',
    notes: '',
    created_at_token: '2026-09-01T09:00:00.000Z',
    updated_at_token: '2026-09-02T09:00:00.000Z',
    ...overrides,
  };
}

describe('createProjectPart', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('inserts with tenant default and writes the created event', async () => {
    queryMock.mockResolvedValueOnce([partRow()]);

    const result = await createProjectPart({
      projectId: UUID,
      description: 'GAL controller, 12 stops',
      quantityRequiredHundredths: 100,
      plannedCostCents: 680000,
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO project_parts');
    expect(sql).toContain('app_require_organization_id()');
    expect(sql).toContain('INSERT INTO project_part_events');
    expect(sql).toContain("'created'");
    expect(params).toContain('actor-1');
    expect(result).toMatchObject({
      projectId: UUID,
      status: 'specified',
      quantityRequiredHundredths: 100,
      plannedCostCents: 680000,
    });
  });

  it('throws without touching the database when input is invalid', async () => {
    await expect(
      createProjectPart({
        projectId: UUID,
        description: 'X',
        quantityRequiredHundredths: 100,
      }),
    ).rejects.toThrow('Invalid project part');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('getProjectPart / listProjectParts', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns null when absent', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(getProjectPart('missing')).resolves.toBeNull();
  });

  it('filters by project, status, package, unit, and item', async () => {
    queryMock.mockResolvedValueOnce([partRow()]);
    await listProjectParts({
      projectId: UUID,
      status: 'ordered',
      workPackageId: UUID,
      elevatorUnitId: UUID,
      inventoryItemId: UUID,
    });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('part.project_id = $1::uuid');
    expect(sql).toContain('part.status = $2::text');
    expect(sql).toContain('part.work_package_id = $3::uuid');
    expect(sql).toContain('part.elevator_unit_id = $4::uuid');
    expect(sql).toContain('part.inventory_item_id = $5::uuid');
    expect(params).toEqual([UUID, 'ordered', UUID, UUID, UUID, 50]);
  });

  it('throws on an invalid status filter before querying', async () => {
    await expect(
      listProjectParts({ status: 'lost' as 'ordered' }),
    ).rejects.toThrow('Invalid part status filter');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('updatePartStatus', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('advances status and appends the event', async () => {
    queryMock
      .mockResolvedValueOnce([{ status: 'specified' }])
      .mockResolvedValueOnce([partRow({ status: 'ordered' })]);

    const result = await updatePartStatus('part-1', 'ordered', 'PO sent');

    expect(result.ok).toBe(true);
    const updateCall = queryMock.mock.calls[1] as [string, unknown[]];
    expect(updateCall[0]).toContain('UPDATE project_parts');
    expect(updateCall[0]).toContain('INSERT INTO project_part_events');
    expect(updateCall[0]).toContain("'status_changed'");
    if (result.ok) expect(result.part.status).toBe('ordered');
  });

  it('refuses rewinds without writing', async () => {
    queryMock.mockResolvedValueOnce([{ status: 'received' }]);
    const result = await updatePartStatus('part-1', 'ordered');
    expect(result).toEqual({ ok: false, error: 'invalid-transition' });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('reports part-not-found', async () => {
    queryMock.mockResolvedValueOnce([]);
    const result = await updatePartStatus('missing', 'ordered');
    expect(result).toEqual({ ok: false, error: 'part-not-found' });
  });
});

describe('recordPartQuantity', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('moves quantities upward and appends the event', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          quantity_received_hundredths: 0,
          quantity_installed_hundredths: 0,
          actual_cost_cents: 0,
        },
      ])
      .mockResolvedValueOnce([
        partRow({
          quantity_received_hundredths: 100,
          actual_cost_cents: 680000,
        }),
      ]);

    const result = await recordPartQuantity('part-1', {
      quantityReceivedHundredths: 100,
      actualCostCents: 680000,
      note: 'Delivered',
    });

    expect(result.ok).toBe(true);
    const updateCall = queryMock.mock.calls[1] as [string, unknown[]];
    expect(updateCall[0]).toContain("'quantity_updated'");
    if (result.ok) {
      expect(result.part.quantityReceivedHundredths).toBe(100);
      expect(result.part.actualCostCents).toBe(680000);
    }
  });

  it('refuses downward quantity or cost moves', async () => {
    queryMock.mockResolvedValueOnce([
      {
        quantity_received_hundredths: 100,
        quantity_installed_hundredths: 0,
        actual_cost_cents: 680000,
      },
    ]);
    const result = await recordPartQuantity('part-1', {
      quantityReceivedHundredths: 50,
    });
    expect(result).toEqual({ ok: false, error: 'invalid' });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('rejects empty updates without querying', async () => {
    const result = await recordPartQuantity('part-1', {});
    expect(result).toEqual({ ok: false, error: 'invalid' });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
