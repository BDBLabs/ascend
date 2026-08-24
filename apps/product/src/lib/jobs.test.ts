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

import { updateJobStatus } from './jobs';

function jobRow(status: string) {
  return {
    id: 'job-123',
    display_id: 'JOB-0042',
    customer_id: '550e8400-e29b-41d4-a716-446655440000',
    customer_name: 'Dana Reyes',
    service_request_id: null,
    estimate_id: null,
    status,
    title: 'Replace panel',
    notes: 'Main breaker swap',
    customer_stated_problem: 'Breakers tripping',
    technician_diagnosis: 'Worn main breaker',
    created_at_token: '2026-08-01T09:00:00.000Z',
    updated_at_token: '2026-08-02T09:00:00.000Z',
  };
}

describe('updateJobStatus', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns the mapped JobRecord when the UPDATE succeeds', async () => {
    queryMock.mockResolvedValueOnce([jobRow('completed')]);

    const result = await updateJobStatus('job-123', 'completed');

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE jobs'),
      ['job-123', 'completed'],
    );
    expect(result).toEqual({
      id: 'job-123',
      displayId: 'JOB-0042',
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      customerName: 'Dana Reyes',
      serviceRequestId: null,
      estimateId: null,
      status: 'completed',
      title: 'Replace panel',
      notes: 'Main breaker swap',
      customerStatedProblem: 'Breakers tripping',
      technicianDiagnosis: 'Worn main breaker',
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-02T09:00:00.000Z',
    });
  });

  it('returns null when the UPDATE returns no rows', async () => {
    queryMock.mockResolvedValueOnce([]);

    const result = await updateJobStatus('missing-job', 'cancelled');

    expect(result).toBeNull();
  });
});
