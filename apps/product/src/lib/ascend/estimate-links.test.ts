import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
}));

import {
  getEstimateProjectMap,
  linkEstimateToProject,
  unlinkEstimateFromProject,
} from './estimate-links';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const EST_UUID = '660e8400-e29b-41d4-a716-446655440001';

describe('linkEstimateToProject', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('links a signed same-customer estimate', async () => {
    queryMock
      .mockResolvedValueOnce([
        { id: UUID, customer_id: UUID, estimate_id: null },
      ])
      .mockResolvedValueOnce([
        { id: EST_UUID, status: 'signed', customer_id: UUID },
      ])
      .mockResolvedValueOnce([]);

    const result = await linkEstimateToProject(EST_UUID, UUID);
    expect(result).toEqual({ ok: true, projectId: UUID, estimateId: EST_UUID });
    const update = queryMock.mock.calls[2] as [string, unknown[]];
    expect(update[0]).toContain('UPDATE modernization_projects SET estimate_id');
  });

  it('is idempotent for the same link', async () => {
    queryMock.mockResolvedValueOnce([
      { id: UUID, customer_id: UUID, estimate_id: EST_UUID },
    ]);
    const result = await linkEstimateToProject(EST_UUID, UUID);
    expect(result).toEqual({ ok: true, projectId: UUID, estimateId: EST_UUID });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('rejects unsigned estimates', async () => {
    queryMock
      .mockResolvedValueOnce([
        { id: UUID, customer_id: UUID, estimate_id: null },
      ])
      .mockResolvedValueOnce([
        { id: EST_UUID, status: 'draft', customer_id: UUID },
      ]);
    const result = await linkEstimateToProject(EST_UUID, UUID);
    expect(result).toEqual({ ok: false, error: 'estimate-not-signed' });
  });

  it('rejects customer mismatches and missing rows', async () => {
    queryMock
      .mockResolvedValueOnce([
        { id: UUID, customer_id: UUID, estimate_id: null },
      ])
      .mockResolvedValueOnce([
        { id: EST_UUID, status: 'signed', customer_id: 'other' },
      ]);
    await expect(linkEstimateToProject(EST_UUID, UUID)).resolves.toEqual({
      ok: false,
      error: 'customer-mismatch',
    });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce([]);
    await expect(linkEstimateToProject(EST_UUID, UUID)).resolves.toEqual({
      ok: false,
      error: 'project-not-found',
    });
  });

  it('rejects a second estimate on an already-linked project', async () => {
    queryMock.mockResolvedValueOnce([
      { id: UUID, customer_id: UUID, estimate_id: 'linked-before' },
    ]);
    const result = await linkEstimateToProject(EST_UUID, UUID);
    expect(result).toEqual({ ok: false, error: 'already-linked' });
  });

  it('maps unique violations to already-linked', async () => {
    queryMock
      .mockResolvedValueOnce([
        { id: UUID, customer_id: UUID, estimate_id: null },
      ])
      .mockResolvedValueOnce([
        { id: EST_UUID, status: 'signed', customer_id: UUID },
      ])
      .mockRejectedValueOnce(new Error('duplicate key value violates unique'));
    const result = await linkEstimateToProject(EST_UUID, UUID);
    expect(result).toEqual({ ok: false, error: 'already-linked' });
  });
});

describe('unlinkEstimateFromProject', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('clears the link only when one exists', async () => {
    queryMock.mockResolvedValueOnce([{ id: UUID }]);
    await expect(unlinkEstimateFromProject(UUID)).resolves.toBe(true);
    queryMock.mockResolvedValueOnce([]);
    await expect(unlinkEstimateFromProject(UUID)).resolves.toBe(false);
  });
});

describe('getEstimateProjectMap', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('maps linked estimates in one query', async () => {
    queryMock.mockResolvedValueOnce([
      { estimate_id: EST_UUID, id: UUID, display_id: 'ASC-0001' },
    ]);
    const map = await getEstimateProjectMap([EST_UUID, 'other']);
    expect(map.get(EST_UUID)).toEqual({
      estimateId: EST_UUID,
      projectId: UUID,
      projectDisplayId: 'ASC-0001',
    });
    expect(map.has('other')).toBe(false);
  });

  it('short-circuits empty input', async () => {
    const map = await getEstimateProjectMap([]);
    expect(map.size).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
