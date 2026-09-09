import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/lib/field-api-auth', () => ({
  getFieldPrincipal: () => ({ kind: 'field' }),
  fieldPrincipalCan: () => true,
  withFieldContext: async (_principal: unknown, work: () => Promise<unknown>) =>
    work(),
}));

vi.mock('@/lib/organization-context-store', () => ({
  requireOrganizationContext: () => ({ actorId: 'actor-1' }),
}));

import { POST } from './route';

function postRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/ascend/packages/${id}/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

function packageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'package-1',
    project_id: '550e8400-e29b-41d4-a716-446655440000',
    project_display_id: 'ASC-0001',
    name: 'Controller',
    category: 'Controller',
    description: '',
    budget_cost_cents: 0,
    contract_value_cents: 0,
    planned_start: null,
    planned_finish: null,
    actual_start: null,
    actual_finish: null,
    status: 'in_progress',
    percent_complete: 40,
    responsible_person: '',
    notes: '',
    elevator_unit_ids: [],
    created_at_token: '2026-09-01T09:00:00.000Z',
    updated_at_token: '2026-09-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('POST /api/ascend/packages/[id]/progress', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('records progress and returns the package', async () => {
    queryMock
      .mockResolvedValueOnce([{ percent_complete: 0, status: 'not_started' }])
      .mockResolvedValueOnce([packageRow()]);

    const response = await POST(
      postRequest('package-1', { percentComplete: 40, status: 'in_progress' }),
      { params: Promise.resolve({ id: 'package-1' }) },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.package.percentComplete).toBe(40);
  });

  it('rejects invalid progress with 400', async () => {
    const response = await POST(
      postRequest('package-1', { percentComplete: 150 }),
      { params: Promise.resolve({ id: 'package-1' }) },
    );
    expect(response.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps terminal packages to 409', async () => {
    queryMock.mockResolvedValueOnce([
      { percent_complete: 30, status: 'cancelled' },
    ]);
    const response = await POST(
      postRequest('package-1', { percentComplete: 40 }),
      { params: Promise.resolve({ id: 'package-1' }) },
    );
    expect(response.status).toBe(409);
  });

  it('maps missing packages to 404', async () => {
    queryMock.mockResolvedValueOnce([]);
    const response = await POST(
      postRequest('missing', { percentComplete: 10 }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(response.status).toBe(404);
  });
});
