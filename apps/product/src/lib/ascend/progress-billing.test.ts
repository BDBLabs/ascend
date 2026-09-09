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

vi.mock('./project-progress', () => ({
  getProjectProgress: vi.fn(),
}));

import {
  approveApplication,
  createApplicationDraft,
  createBillingPeriod,
  getApplication,
  listApplications,
  listBillingPeriods,
  markApplicationInvoiced,
  rejectApplication,
  setBillingSchedule,
  submitApplication,
  voidApplicationDraft,
} from './progress-billing';
import { getProjectProgress } from './project-progress';

const getProgressMock = vi.mocked(getProjectProgress);

const UUID = '550e8400-e29b-41d4-a716-446655440000';

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    billing_period_id: 'period-1',
    period_number: 1,
    project_id: UUID,
    project_display_id: 'ASC-0001',
    invoice_id: null,
    status: 'draft',
    contract_value_cents: 10000000,
    earned_value_cents: 5920000,
    previously_billed_cents: 0,
    retainage_percent: 10,
    retainage_cents: 592000,
    stored_materials_cents: 0,
    current_due_cents: 5328000,
    notes: '',
    created_at_token: '2026-11-01T09:00:00.000Z',
    updated_at_token: '2026-11-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('setBillingSchedule', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('upserts the project schedule', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'sched-1',
        project_id: UUID,
        retainage_percent: 10,
        notes: '',
        created_at_token: '2026-09-01T09:00:00.000Z',
        updated_at_token: '2026-09-01T09:00:00.000Z',
      },
    ]);
    const result = await setBillingSchedule({
      projectId: UUID,
      retainagePercent: 10,
    });
    const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT (project_id, organization_id)');
    expect(result.retainagePercent).toBe(10);
  });

  it('throws on invalid input without querying', async () => {
    await expect(
      setBillingSchedule({ projectId: UUID, retainagePercent: 150 }),
    ).rejects.toThrow('Invalid billing schedule');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('createBillingPeriod / listBillingPeriods', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('inserts numbered periods', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'period-1',
        project_id: UUID,
        period_number: 1,
        period_start: '2026-10-01',
        period_end: '2026-10-31',
        status: 'open',
        created_at_token: '2026-09-01T09:00:00.000Z',
        updated_at_token: '2026-09-01T09:00:00.000Z',
      },
    ]);
    const result = await createBillingPeriod({
      projectId: UUID,
      periodNumber: 1,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    expect(result.periodNumber).toBe(1);
    expect(result.status).toBe('open');
  });

  it('lists periods in order', async () => {
    queryMock.mockResolvedValueOnce([]);
    await listBillingPeriods(UUID);
    const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ORDER BY period_number ASC');
  });
});

describe('createApplicationDraft', () => {
  beforeEach(() => {
    queryMock.mockReset();
    getProgressMock.mockReset();
  });

  it('freezes earned, previously billed, and retainage into the snapshot', async () => {
    const periodRows = [
      { id: 'period-1', project_id: UUID, period_number: 1, status: 'open' },
    ];
    queryMock
      .mockResolvedValueOnce(periodRows)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'sched-1',
          project_id: UUID,
          retainage_percent: 10,
          notes: '',
          created_at_token: 'x',
          updated_at_token: 'x',
        },
      ])
      .mockResolvedValueOnce([{ total: 2000000 }])
      .mockResolvedValueOnce([applicationRow()]);

    getProgressMock.mockResolvedValueOnce({
      projectId: UUID,
      displayId: 'ASC-0001',
      contractValueCents: 10000000,
      earnedValueCents: 5920000,
    } as never);

    const result = await createApplicationDraft('period-1', {});

    expect(result.ok).toBe(true);
    // insert params: [period, project, contract, earned, prev, pct,
    //   retainage, stored, due, notes, actor, periodNo]
    const insertCall = queryMock.mock.calls[4] as [string, unknown[]];
    expect(insertCall[0]).toContain('INSERT INTO progress_applications');
    expect(insertCall[0]).toContain("'created'");
    // earned 5,920,000 − prev 2,000,000 − 10% retainage 592,000
    expect(insertCall[1][4]).toBe(2000000);
    expect(insertCall[1][6]).toBe(592000);
    expect(insertCall[1][8]).toBe(3328000);
    if (result.ok) expect(result.application.status).toBe('draft');
  });

  it('refuses closed periods and duplicate applications', async () => {
    queryMock.mockResolvedValueOnce([
      { id: 'period-1', project_id: UUID, period_number: 1, status: 'closed' },
    ]);
    await expect(createApplicationDraft('period-1', {})).resolves.toEqual({
      ok: false,
      error: 'period-not-open',
    });

    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce([
        { id: 'period-1', project_id: UUID, period_number: 1, status: 'open' },
      ])
      .mockResolvedValueOnce([{ id: 'app-1' }]);
    await expect(createApplicationDraft('period-1', {})).resolves.toEqual({
      ok: false,
      error: 'already-applied',
    });
  });
});

describe('application transitions', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('submits a draft and appends the event', async () => {
    queryMock
      .mockResolvedValueOnce([{ status: 'draft' }])
      .mockResolvedValueOnce([applicationRow({ status: 'submitted' })]);

    const result = await submitApplication('app-1', 'Ready for review');

    expect(result.ok).toBe(true);
    const updateCall = queryMock.mock.calls[1] as [string, unknown[]];
    expect(updateCall[0]).toContain('UPDATE progress_applications');
    expect(updateCall[0]).toContain('INSERT INTO progress_application_events');
    // status travels as a bound param; actor lands in the event insert
    expect(updateCall[1][1]).toBe('submitted');
    expect(updateCall[1]).toContain('actor-1');
    if (result.ok) expect(result.application.status).toBe('submitted');
  });

  it('rejects illegal transitions without writing', async () => {
    queryMock.mockResolvedValueOnce([{ status: 'draft' }]);
    const result = await approveApplication('app-1');
    expect(result).toEqual({ ok: false, error: 'invalid-transition' });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('approves then invoices with linkage and period close', async () => {
    queryMock
      .mockResolvedValueOnce([{ status: 'submitted' }])
      .mockResolvedValueOnce([
        applicationRow({ status: 'approved', invoice_id: null }),
      ]);
    const approved = await approveApplication('app-1');
    expect(approved.ok).toBe(true);

    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce([{ id: 'inv-1' }])
      .mockResolvedValueOnce([{ status: 'approved' }])
      .mockResolvedValueOnce([
        applicationRow({ status: 'invoiced', invoice_id: 'inv-1' }),
      ])
      .mockResolvedValueOnce([]);
    const invoiced = await markApplicationInvoiced('app-1', 'inv-1');
    expect(invoiced.ok).toBe(true);
    const periodClose = queryMock.mock.calls[3] as [string, unknown[]];
    expect(periodClose[0]).toContain("status = 'closed'");
    if (invoiced.ok) expect(invoiced.application.invoiceId).toBe('inv-1');
  });

  it('refuses invoicing against a missing invoice', async () => {
    queryMock.mockResolvedValueOnce([]);
    const result = await markApplicationInvoiced('app-1', 'missing');
    expect(result).toEqual({ ok: false, error: 'invoice-not-found' });
  });

  it('rejects back to submitted for rework', async () => {
    queryMock
      .mockResolvedValueOnce([{ status: 'submitted' }])
      .mockResolvedValueOnce([applicationRow({ status: 'rejected' })]);
    const result = await rejectApplication('app-1', 'Fix the math');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.application.status).toBe('rejected');
  });
});

describe('voidApplicationDraft', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('deletes drafts atomically', async () => {
    queryMock.mockResolvedValueOnce([{ id: 'app-1' }]);
    const result = await voidApplicationDraft('app-1');
    expect(result).toEqual({ ok: true });
    const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status = 'draft'");
  });

  it('refuses non-drafts and missing rows distinctly', async () => {
    queryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'app-1' }]);
    const result = await voidApplicationDraft('app-1');
    expect(result).toEqual({ ok: false, error: 'not-draft' });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const missing = await voidApplicationDraft('missing');
    expect(missing).toEqual({ ok: false, error: 'application-not-found' });
  });
});

describe('getApplication / listApplications', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns null when absent and lists in period order', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(getApplication('missing')).resolves.toBeNull();
    queryMock.mockResolvedValueOnce([applicationRow()]);
    await listApplications(UUID);
    const [sql] = queryMock.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('ORDER BY period.period_number ASC');
  });
});
