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
  getCostEntry,
  listCostEntries,
  recordCostEntry,
  recordLaborCost,
  summarizeProjectCosts,
} from './project-costs';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    project_id: UUID,
    project_display_id: 'ASC-0001',
    elevator_unit_id: null,
    elevator_unit_number: null,
    work_package_id: null,
    work_package_name: null,
    cost_kind: 'actual',
    cost_category: 'material',
    amount_cents: 125000,
    labor_hours_hundredths: null,
    labor_rate_cents_per_hour: null,
    cost_date: '2026-10-05',
    source_type: 'invoice',
    source_ref: 'INV-1',
    actor_id: 'actor-1',
    description: 'Controller deposit',
    created_at_token: '2026-10-05T09:00:00.000Z',
    updated_at_token: '2026-10-05T09:00:00.000Z',
    ...overrides,
  };
}

describe('recordCostEntry', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('inserts with tenant default, actor, and joined names', async () => {
    queryMock.mockResolvedValueOnce([entryRow()]);

    const result = await recordCostEntry({
      projectId: UUID,
      costKind: 'actual',
      costCategory: 'material',
      amountCents: 125000,
      costDate: '2026-10-05',
      sourceType: 'invoice',
      sourceRef: 'INV-1',
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO project_cost_entries');
    expect(sql).toContain('app_require_organization_id()');
    expect(params).toContain('actor-1');
    expect(params).toContain(125000);
    expect(result).toMatchObject({
      projectId: UUID,
      projectDisplayId: 'ASC-0001',
      costKind: 'actual',
      amountCents: 125000,
      actorId: 'actor-1',
    });
  });

  it('throws without touching the database when input is invalid', async () => {
    await expect(
      recordCostEntry({
        projectId: UUID,
        costKind: 'actual',
        costCategory: 'material',
        amountCents: -5,
        costDate: '2026-10-05',
      }),
    ).rejects.toThrow('Invalid cost entry');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('recordLaborCost', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('derives the amount and stores labor evidence', async () => {
    queryMock.mockResolvedValueOnce([
      entryRow({
        cost_category: 'labor',
        amount_cents: 80750,
        labor_hours_hundredths: 850,
        labor_rate_cents_per_hour: 9500,
      }),
    ]);

    const result = await recordLaborCost({
      projectId: UUID,
      costKind: 'actual',
      hoursHundredths: 850,
      rateCentsPerHour: 9500,
      costDate: '2026-10-06',
    });

    const [, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params).toContain(80750);
    expect(result).toMatchObject({
      costCategory: 'labor',
      amountCents: 80750,
      laborHoursHundredths: 850,
      laborRateCentsPerHour: 9500,
    });
  });
});

describe('getCostEntry / listCostEntries', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns null when absent', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(getCostEntry('missing')).resolves.toBeNull();
  });

  it('filters by project, kind, category, package, unit, and dates', async () => {
    queryMock.mockResolvedValueOnce([entryRow()]);
    await listCostEntries({
      projectId: UUID,
      costKind: 'actual',
      costCategory: 'labor',
      workPackageId: UUID,
      elevatorUnitId: UUID,
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
    });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('entry.project_id = $1::uuid');
    expect(sql).toContain('entry.cost_kind = $2::text');
    expect(sql).toContain('entry.cost_category = $3::text');
    expect(sql).toContain('entry.work_package_id = $4::uuid');
    expect(sql).toContain('entry.elevator_unit_id = $5::uuid');
    expect(sql).toContain('entry.cost_date >=');
    expect(sql).toContain('entry.cost_date <=');
    expect(params.slice(0, 7)).toEqual([
      UUID,
      'actual',
      'labor',
      UUID,
      UUID,
      '2026-10-01',
      '2026-10-31',
    ]);
  });

  it('throws on invalid enum filters before querying', async () => {
    await expect(
      listCostEntries({ costKind: 'spent' as 'actual' }),
    ).rejects.toThrow('Invalid cost kind filter');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('summarizeProjectCosts', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('rolls up server-side sums into per-lens totals', async () => {
    queryMock.mockResolvedValueOnce([
      { cost_kind: 'actual', cost_category: 'material', total_cents: '125000', entry_count: 2 },
      { cost_kind: 'actual', cost_category: 'labor', total_cents: 80750, entry_count: 1 },
      { cost_kind: 'forecast', cost_category: 'material', total_cents: '40000', entry_count: 1 },
    ]);

    const summary = await summarizeProjectCosts(UUID);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('GROUP BY cost_kind, cost_category');
    expect(sql).toContain('SUM(amount_cents)');
    expect(params).toEqual([UUID]);
    expect(summary.totalsByKind).toEqual({
      budget: 0,
      actual: 205750,
      committed: 0,
      forecast: 40000,
    });
    expect(summary.buckets).toHaveLength(3);
  });
});

describe('summarizeCostsByWorkPackage', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('groups package-linked entries per package and kind', async () => {
    const { summarizeCostsByWorkPackage } = await import('./project-costs');
    queryMock.mockResolvedValueOnce([
      { work_package_id: 'p1', cost_kind: 'actual', total_cents: '300000' },
      { work_package_id: 'p1', cost_kind: 'budget', total_cents: 450000 },
      { work_package_id: 'p2', cost_kind: 'actual', total_cents: '10000' },
    ]);

    const result = await summarizeCostsByWorkPackage(UUID);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('GROUP BY work_package_id, cost_kind');
    expect(sql).toContain('work_package_id IS NOT NULL');
    expect(params).toEqual([UUID]);
    expect(result).toEqual([
      {
        workPackageId: 'p1',
        totals: { budget: 450000, actual: 300000, committed: 0, forecast: 0 },
      },
      {
        workPackageId: 'p2',
        totals: { budget: 0, actual: 10000, committed: 0, forecast: 0 },
      },
    ]);
  });
});

describe('getProjectBilledCents', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('sums issued-and-beyond invoices on invoiced applications', async () => {
    const { getProjectBilledCents } = await import('./project-costs');
    queryMock.mockResolvedValueOnce([{ total: '900000' }]);
    await expect(getProjectBilledCents(UUID)).resolves.toBe(900000);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("app.status = 'invoiced'");
    expect(sql).toContain("'issued', 'partially_paid', 'paid'");
    expect(params).toEqual([UUID]);
  });
});
