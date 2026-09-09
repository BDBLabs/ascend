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
  createWorkPackage,
  getWorkPackage,
  linkUnitToWorkPackage,
  listWorkPackages,
  recordWorkPackageProgress,
  unlinkUnitFromWorkPackage,
} from './work-packages';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UNIT_UUID = '660e8400-e29b-41d4-a716-446655440001';

function packageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'package-1',
    project_id: UUID,
    project_display_id: 'ASC-0001',
    name: 'Controller',
    category: 'Controller',
    description: 'Replace controller and drives',
    budget_cost_cents: 4500000,
    contract_value_cents: 6800000,
    planned_start: '2026-10-01',
    planned_finish: '2026-12-01',
    actual_start: null,
    actual_finish: null,
    status: 'not_started',
    percent_complete: 0,
    responsible_person: '',
    notes: '',
    elevator_unit_ids: [],
    created_at_token: '2026-09-01T09:00:00.000Z',
    updated_at_token: '2026-09-02T09:00:00.000Z',
    ...overrides,
  };
}

describe('createWorkPackage', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('inserts with tenant default and writes the created event', async () => {
    queryMock.mockResolvedValueOnce([packageRow()]);

    const result = await createWorkPackage({
      projectId: UUID,
      name: 'Controller',
      budgetCostCents: 4500000,
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO work_packages');
    expect(sql).toContain('app_require_organization_id()');
    expect(sql).toContain("INSERT INTO work_package_events");
    expect(sql).toContain("'created'");
    expect(params).toContain('actor-1');
    expect(result).toMatchObject({
      projectId: UUID,
      projectDisplayId: 'ASC-0001',
      name: 'Controller',
      budgetCostCents: 4500000,
      status: 'not_started',
      percentComplete: 0,
    });
  });

  it('throws without touching the database when input is invalid', async () => {
    await expect(
      createWorkPackage({ projectId: UUID, name: 'X' }),
    ).rejects.toThrow('Invalid work package');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('getWorkPackage / listWorkPackages', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns null when absent', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(getWorkPackage('missing')).resolves.toBeNull();
  });

  it('scopes by project and status with a bounded limit', async () => {
    queryMock.mockResolvedValueOnce([packageRow()]);
    await listWorkPackages({
      projectId: UUID,
      status: 'in_progress',
      limit: 5,
    });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('package.project_id = $1::uuid');
    expect(sql).toContain('package.status = $2::text');
    expect(params).toEqual([UUID, 'in_progress', 5]);
  });

  it('throws on an invalid status filter before querying', async () => {
    await expect(
      listWorkPackages({ status: 'done' as 'complete' }),
    ).rejects.toThrow('Invalid work package status filter');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('linkUnitToWorkPackage / unlinkUnitFromWorkPackage', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('links when both rows exist in the tenant', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 'package-1' }])
      .mockResolvedValueOnce([{ id: UNIT_UUID }])
      .mockResolvedValueOnce([]);
    const result = await linkUnitToWorkPackage('package-1', UNIT_UUID);
    expect(result).toEqual({
      ok: true,
      workPackageId: 'package-1',
      elevatorUnitId: UNIT_UUID,
    });
  });

  it('reports package-not-found and unit-not-found without inserting', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(linkUnitToWorkPackage('missing', UNIT_UUID)).resolves.toEqual({
      ok: false,
      error: 'package-not-found',
    });
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce([{ id: 'package-1' }])
      .mockResolvedValueOnce([]);
    await expect(
      linkUnitToWorkPackage('package-1', UNIT_UUID),
    ).resolves.toEqual({ ok: false, error: 'unit-not-found' });
  });

  it('maps the uniqueness guard to already-linked', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 'package-1' }])
      .mockResolvedValueOnce([{ id: UNIT_UUID }])
      .mockRejectedValueOnce(new Error('duplicate key value violates unique'));
    await expect(
      linkUnitToWorkPackage('package-1', UNIT_UUID),
    ).resolves.toEqual({ ok: false, error: 'already-linked' });
  });

  it('unlink returns true when a link was removed', async () => {
    queryMock.mockResolvedValueOnce([{ id: 'link-1' }]);
    await expect(
      unlinkUnitFromWorkPackage('package-1', UNIT_UUID),
    ).resolves.toBe(true);
    queryMock.mockResolvedValueOnce([]);
    await expect(
      unlinkUnitFromWorkPackage('package-1', UNIT_UUID),
    ).resolves.toBe(false);
  });
});

describe('recordWorkPackageProgress', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('updates percent and appends a progress event', async () => {
    queryMock
      .mockResolvedValueOnce([{ percent_complete: 0, status: 'not_started' }])
      .mockResolvedValueOnce([
        packageRow({ percent_complete: 40, status: 'in_progress' }),
      ]);

    const result = await recordWorkPackageProgress('package-1', {
      percentComplete: 40,
      status: 'in_progress',
      note: 'Controller mounted',
    });

    expect(result.ok).toBe(true);
    const updateCall = queryMock.mock.calls[1] as [string, unknown[]];
    expect(updateCall[0]).toContain('UPDATE work_packages');
    expect(updateCall[0]).toContain('INSERT INTO work_package_events');
    expect(updateCall[0]).toContain("'progress_changed'");
    if (result.ok) {
      expect(result.package.percentComplete).toBe(40);
      expect(result.package.status).toBe('in_progress');
    }
  });

  it('reports package-not-found without writing', async () => {
    queryMock.mockResolvedValueOnce([]);
    const result = await recordWorkPackageProgress('missing', {
      percentComplete: 10,
    });
    expect(result).toEqual({ ok: false, error: 'package-not-found' });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid progress without querying', async () => {
    const result = await recordWorkPackageProgress('package-1', {
      percentComplete: 50,
      status: 'complete',
    });
    expect(result).toEqual({ ok: false, error: 'invalid' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('skips the event write when nothing changed', async () => {
    queryMock
      .mockResolvedValueOnce([{ percent_complete: 40, status: 'in_progress' }])
      .mockResolvedValueOnce([
        packageRow({ percent_complete: 40, status: 'in_progress' }),
      ]);

    const result = await recordWorkPackageProgress('package-1', {
      percentComplete: 40,
      status: 'in_progress',
    });

    expect(result.ok).toBe(true);
    const secondCall = queryMock.mock.calls[1] as [string, unknown[]];
    expect(secondCall[0]).not.toContain('work_package_events');
  });
});
