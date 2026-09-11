import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
}));

import {
  createModernizationProject,
  getModernizationProject,
  linkElevatorToProject,
  listModernizationProjects,
  unlinkElevatorFromProject,
} from './modernization-projects';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UNIT_UUID = '660e8400-e29b-41d4-a716-446655440001';

function projectRow() {
  return {
    id: 'project-1',
    display_id: 'ASC-0001',
    customer_id: UUID,
    customer_name: 'Acme Realty',
    building_id: UUID,
    building_name: 'One Court Square',
    status: 'awarded',
    contract_value_cents: 25000000,
    project_manager: 'Bill Parris',
    start_date: '2026-10-01',
    target_completion_date: '2027-03-01',
    actual_completion_date: null,
    notes: '',
    elevator_unit_ids: [UNIT_UUID],
    created_at_token: '2026-09-01T09:00:00.000Z',
    updated_at_token: '2026-09-02T09:00:00.000Z',
  };
}

describe('createModernizationProject', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('inserts with tenant default, integer-cent value, and maps links', async () => {
    queryMock.mockResolvedValueOnce([projectRow()]);

    const result = await createModernizationProject({
      displayId: 'ASC-0001',
      customerId: UUID,
      status: 'awarded',
      contractValueCents: 25000000,
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO modernization_projects');
    expect(sql).toContain('app_require_organization_id()');
    expect(params).toContain(25000000);
    expect(result).toMatchObject({
      displayId: 'ASC-0001',
      status: 'awarded',
      contractValueCents: 25000000,
      elevatorUnitIds: [UNIT_UUID],
      startDate: '2026-10-01',
    });
    expect(Number.isInteger(result.contractValueCents)).toBe(true);
  });

  it('throws without touching the database when input is invalid', async () => {
    await expect(
      createModernizationProject({
        displayId: 'bad id!',
        customerId: UUID,
        contractValueCents: 10.5,
      }),
    ).rejects.toThrow('Invalid project');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('getModernizationProject', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns null when absent', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(getModernizationProject('missing')).resolves.toBeNull();
  });

  it('aggregates linked units in the same query', async () => {
    queryMock.mockResolvedValueOnce([projectRow()]);
    const result = await getModernizationProject('project-1');
    const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('project_elevators');
    expect(result?.elevatorUnitIds).toEqual([UNIT_UUID]);
  });
});

describe('listModernizationProjects', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('scopes by customer, building, and status', async () => {
    queryMock.mockResolvedValueOnce([projectRow()]);
    await listModernizationProjects({
      customerId: UUID,
      buildingId: UUID,
      status: 'awarded',
    });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('project.customer_id = $1::uuid');
    expect(sql).toContain('project.building_id = $2::uuid');
    expect(sql).toContain('project.status = $3::text');
    expect(params).toEqual([UUID, UUID, 'awarded', 50]);
  });

  it('throws on an invalid status filter before querying', async () => {
    await expect(
      listModernizationProjects({ status: 'done' as 'closed' }),
    ).rejects.toThrow('Invalid project status filter');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('linkElevatorToProject', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('links when both rows exist in the tenant', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 'project-1' }])
      .mockResolvedValueOnce([{ id: UNIT_UUID }])
      .mockResolvedValueOnce([]);
    const result = await linkElevatorToProject('project-1', UNIT_UUID);
    expect(result).toEqual({
      ok: true,
      projectId: 'project-1',
      elevatorUnitId: UNIT_UUID,
    });
    const insertCall = queryMock.mock.calls[2] as [string, unknown[]];
    expect(insertCall[0]).toContain('INSERT INTO project_elevators');
  });

  it('reports project-not-found without further queries', async () => {
    queryMock.mockResolvedValueOnce([]);
    const result = await linkElevatorToProject('missing', UNIT_UUID);
    expect(result).toEqual({ ok: false, error: 'project-not-found' });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('reports unit-not-found without inserting', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 'project-1' }])
      .mockResolvedValueOnce([]);
    const result = await linkElevatorToProject('project-1', UNIT_UUID);
    expect(result).toEqual({ ok: false, error: 'unit-not-found' });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('maps the uniqueness guard to already-linked', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 'project-1' }])
      .mockResolvedValueOnce([{ id: UNIT_UUID }])
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint'),
      );
    const result = await linkElevatorToProject('project-1', UNIT_UUID);
    expect(result).toEqual({ ok: false, error: 'already-linked' });
  });
});

describe('unlinkElevatorFromProject', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns true when a link was removed, false otherwise', async () => {
    queryMock.mockResolvedValueOnce([{ id: 'link-1' }]);
    await expect(
      unlinkElevatorFromProject('project-1', UNIT_UUID),
    ).resolves.toBe(true);
    queryMock.mockResolvedValueOnce([]);
    await expect(
      unlinkElevatorFromProject('project-1', UNIT_UUID),
    ).resolves.toBe(false);
  });
});

describe('updateModernizationProject', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('merges, validates, and returns the refreshed record', async () => {
    const { updateModernizationProject } = await import(
      './modernization-projects'
    );
    queryMock
      .mockResolvedValueOnce([
        {
          display_id: 'ASC-0001',
          customer_id: UUID,
          building_id: UUID,
          status: 'awarded',
          contract_value_cents: 10000000,
          project_manager: '',
          start_date: '2026-10-01',
          target_completion_date: null,
          actual_completion_date: null,
          notes: '',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...projectRow(), status: 'in_progress' },
      ]);

    const result = await updateModernizationProject(UUID, {
      status: 'in_progress',
      projectManager: 'Bill Parris',
    });
    expect(result?.status).toBe('in_progress');
    const update = queryMock.mock.calls[1] as [string, unknown[]];
    expect(update[0]).toContain('UPDATE modernization_projects');
  });

  it('returns null for missing projects and throws on invalid merges', async () => {
    const { updateModernizationProject } = await import(
      './modernization-projects'
    );
    queryMock.mockResolvedValueOnce([]);
    await expect(updateModernizationProject(UUID, {})).resolves.toBeNull();

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce([
      {
        display_id: 'ASC-0001',
        customer_id: UUID,
        building_id: UUID,
        status: 'awarded',
        contract_value_cents: 10000000,
        project_manager: '',
        start_date: '2026-10-01',
        target_completion_date: null,
        actual_completion_date: null,
        notes: '',
      },
    ]);
    await expect(
      updateModernizationProject(UUID, {
        startDate: '2026-12-01',
        targetCompletionDate: '2026-01-01',
      }),
    ).rejects.toThrow('Invalid project');
  });
});
