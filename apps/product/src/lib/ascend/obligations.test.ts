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
  attachEvidence,
  createActivity,
  createMilestone,
  createObligation,
  getObligationDetail,
  listActivities,
  listEvidence,
  listMilestones,
  listObligations,
  setActivityStatus,
  setMilestoneStatus,
  setObligationStatus,
} from './obligations';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('createObligation / listObligations', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('inserts with tenant default and logs creation', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'obl-1',
        project_id: UUID,
        title: 'Maintain service',
        description: '',
        source_ref: '§3.2',
        due_date: null,
        status: 'open',
        created_at_token: 'x',
        updated_at_token: 'x',
      },
    ]);
    const result = await createObligation({
      projectId: UUID,
      title: 'Maintain service',
      sourceRef: '§3.2',
    });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO contract_obligations');
    expect(sql).toContain("'created'");
    expect(params).toContain('actor-1');
    expect(result).toMatchObject({ status: 'open', sourceRef: '§3.2' });
  });

  it('throws on invalid input without querying', async () => {
    await expect(
      createObligation({ projectId: UUID, title: 'X' }),
    ).rejects.toThrow('Invalid obligation');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('lists by project', async () => {
    queryMock.mockResolvedValueOnce([]);
    await listObligations(UUID);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('project_id = $1::uuid');
    expect(params).toEqual([UUID]);
  });
});

describe('setObligationStatus', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('transitions open to satisfied with an event', async () => {
    queryMock
      .mockResolvedValueOnce([{ status: 'open' }])
      .mockResolvedValueOnce([
        {
          id: 'obl-1',
          project_id: UUID,
          title: 'T',
          description: '',
          source_ref: '',
          due_date: null,
          status: 'satisfied',
          created_at_token: 'x',
          updated_at_token: 'x',
        },
      ]);
    const result = await setObligationStatus('obl-1', 'satisfied');
    expect(result.ok).toBe(true);
    const update = queryMock.mock.calls[1] as [string, unknown[]];
    expect(update[0]).toContain("'status_changed'");
  });

  it('refuses terminal exits', async () => {
    queryMock.mockResolvedValueOnce([{ status: 'satisfied' }]);
    const result = await setObligationStatus('obl-1', 'open');
    expect(result).toEqual({ ok: false, error: 'invalid-transition' });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe('milestones', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('creates and lists milestones', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'm-1',
        obligation_id: 'obl-1',
        title: 'Interim',
        description: '',
        due_date: null,
        status: 'pending',
        created_at_token: 'x',
        updated_at_token: 'x',
      },
    ]);
    const created = await createMilestone({
      obligationId: '770e8400-e29b-41d4-a716-446655440002',
      title: 'Interim',
    });
    expect(created.status).toBe('pending');
    queryMock.mockResolvedValueOnce([]);
    await listMilestones('obl-1');
  });

  it('recovers missed milestones to met', async () => {
    queryMock
      .mockResolvedValueOnce([{ status: 'missed', obligation_id: 'obl-1' }])
      .mockResolvedValueOnce([
        {
          id: 'm-1',
          obligation_id: 'obl-1',
          title: 'Interim',
          description: '',
          due_date: null,
          status: 'met',
          created_at_token: 'x',
          updated_at_token: 'x',
        },
      ]);
    const result = await setMilestoneStatus('m-1', 'met');
    expect(result.ok).toBe(true);
  });
});

describe('activities and evidence', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('creates activities pinned to packages', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'a-1',
        milestone_id: 'm-1',
        work_package_id: UUID,
        work_package_name: 'Controller',
        title: 'Torque test',
        description: '',
        evidence_required: true,
        evidence_count: 0,
        status: 'pending',
        created_at_token: 'x',
        updated_at_token: 'x',
      },
    ]);
    const created = await createActivity({
      milestoneId: '880e8400-e29b-41d4-a716-446655440003',
      workPackageId: UUID,
      title: 'Torque test',
      evidenceRequired: true,
    });
    expect(created).toMatchObject({
      workPackageName: 'Controller',
      evidenceRequired: true,
    });
  });

  it('blocks completion while required evidence is missing', async () => {
    queryMock.mockResolvedValueOnce([
      {
        status: 'pending',
        evidence_required: true,
        milestone_id: 'm-1',
        obligation_id: 'obl-1',
        evidence_count: 0,
      },
    ]);
    const result = await setActivityStatus('a-1', 'done');
    expect(result).toEqual({ ok: false, error: 'evidence-required' });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('attaches evidence and lists it', async () => {
    queryMock
      .mockResolvedValueOnce([{ obligation_id: 'obl-1', milestone_id: 'm-1' }])
      .mockResolvedValueOnce([
        {
          id: 'e-1',
          activity_id: 'a-1',
          kind: 'photo',
          ref: 'store/1.jpg',
          note: '',
          actor_id: 'actor-1',
          created_at_token: 'x',
        },
      ]);
    const attached = await attachEvidence('a-1', {
      kind: 'photo',
      ref: 'store/1.jpg',
    });
    expect(attached.ok).toBe(true);
    const insert = queryMock.mock.calls[1] as [string, unknown[]];
    expect(insert[0]).toContain("'evidence_attached'");

    queryMock.mockResolvedValueOnce([]);
    await listEvidence('a-1');
    queryMock.mockResolvedValueOnce([]);
    await listActivities('m-1');
  });
});

describe('getObligationDetail', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns null for missing obligations', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(getObligationDetail('missing')).resolves.toBeNull();
  });

  it('assembles the milestone-activity-evidence tree', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          id: 'obl-1',
          project_id: UUID,
          title: 'T',
          description: '',
          source_ref: '',
          due_date: null,
          status: 'open',
          created_at_token: 'x',
          updatedAt_token: 'x',
          updated_at_token: 'x',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'm-1',
          obligation_id: 'obl-1',
          title: 'M',
          description: '',
          due_date: null,
          status: 'pending',
          created_at_token: 'x',
          updated_at_token: 'x',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'a-1',
          milestone_id: 'm-1',
          work_package_id: null,
          work_package_name: null,
          title: 'A',
          description: '',
          evidence_required: false,
          evidence_count: 1,
          status: 'pending',
          created_at_token: 'x',
          updated_at_token: 'x',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'e-1',
          activity_id: 'a-1',
          kind: 'note',
          ref: '',
          note: 'done',
          actor_id: null,
          created_at_token: 'x',
        },
      ]);
    const detail = await getObligationDetail('obl-1');
    expect(detail?.milestones).toHaveLength(1);
    expect(detail?.milestones[0]?.activities).toHaveLength(1);
    expect(detail?.milestones[0]?.activities[0]?.evidence).toHaveLength(1);
  });
});
