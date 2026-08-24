import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { updateJobStatusMock, configuredMock, principalCanMock } = vi.hoisted(() => ({
  updateJobStatusMock: vi.fn(),
  configuredMock: vi.fn(() => true),
  principalCanMock: vi.fn(() => true),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: vi.fn() }),
  platformDb: () => ({ query: vi.fn() }),
  isDatabaseConfigured: configuredMock,
}));

vi.mock('@/lib/jobs', () => ({
  updateJobStatus: updateJobStatusMock,
}));

vi.mock('@/lib/field-api-auth', () => ({
  getFieldPrincipal: () => ({ kind: 'field', organizationId: 'org-1' }),
  fieldPrincipalCan: principalCanMock,
  withFieldContext: async (_principal: unknown, work: () => Promise<unknown>) => work(),
}));

import { POST } from './route';

const params = Promise.resolve({ id: 'job-123' });

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/field/jobs/job-123/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const JOB_RECORD = {
  id: 'job-123',
  displayId: 'JOB-0042',
  customerId: '550e8400-e29b-41d4-a716-446655440000',
  customerName: 'Dana Reyes',
  serviceRequestId: null,
  estimateId: null,
  status: 'in_progress',
  title: 'Replace panel',
  notes: 'Main breaker swap',
  customerStatedProblem: 'Breakers tripping',
  technicianDiagnosis: '',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-02T09:00:00.000Z',
};

describe('job status transition', () => {
  beforeEach(() => {
    updateJobStatusMock.mockReset();
    configuredMock.mockReset();
    configuredMock.mockReturnValue(true);
    principalCanMock.mockReset();
    principalCanMock.mockReturnValue(true);
  });

  it('returns 401 when the principal cannot write jobs', async () => {
    principalCanMock.mockReturnValue(false);

    const response = await POST(postRequest({ status: 'in_progress' }), { params });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(updateJobStatusMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the database is not configured', async () => {
    configuredMock.mockReturnValue(false);

    const response = await POST(postRequest({ status: 'in_progress' }), { params });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Service unavailable' });
    expect(updateJobStatusMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const response = await POST(postRequest('{oops'), { params });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid body' });
    expect(updateJobStatusMock).not.toHaveBeenCalled();
  });

  it('returns 400 when status is missing', async () => {
    const response = await POST(postRequest({}), { params });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid status' });
    expect(updateJobStatusMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the status is not a known job status', async () => {
    const response = await POST(postRequest({ status: 'bogus' }), { params });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid status' });
    expect(updateJobStatusMock).not.toHaveBeenCalled();
  });

  it('updates the job and returns the record for a valid transition', async () => {
    const updated = { ...JOB_RECORD };
    updateJobStatusMock.mockResolvedValueOnce(updated);

    const response = await POST(postRequest({ status: 'in_progress' }), { params });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.job).toEqual(updated);
    expect(updateJobStatusMock).toHaveBeenCalledWith('job-123', 'in_progress');
  });

  it('returns 404 when the job does not exist', async () => {
    updateJobStatusMock.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ status: 'completed' }), { params });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Job not found' });
    expect(updateJobStatusMock).toHaveBeenCalledWith('job-123', 'completed');
  });

  it('returns 503 when the status update throws', async () => {
    updateJobStatusMock.mockRejectedValue(new Error('connection refused'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await POST(postRequest({ status: 'completed' }), { params });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: 'Failed to update job status' });
    } finally {
      consoleError.mockRestore();
    }
  });
});
