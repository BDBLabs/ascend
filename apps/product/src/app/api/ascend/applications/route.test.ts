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

vi.mock('@/lib/ascend/project-progress', () => ({
  getProjectProgress: vi.fn(),
}));

import { POST } from './route';
import { getProjectProgress } from '@/lib/ascend/project-progress';

const getProgressMock = vi.mocked(getProjectProgress);

const UUID = '550e8400-e29b-41d4-a716-446655440000';

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ascend/applications', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ascend/applications', () => {
  beforeEach(() => {
    queryMock.mockReset();
    getProgressMock.mockReset();
  });

  it('drafts an application from live progress and returns 201', async () => {
    queryMock
      .mockResolvedValueOnce([
        { id: 'period-1', project_id: UUID, period_number: 1, status: 'open' },
      ])
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
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([
        {
          id: 'app-1',
          billing_period_id: 'period-1',
          period_number: 1,
          project_id: UUID,
          project_display_id: 'ASC-0001',
          invoice_id: null,
          status: 'draft',
          contract_value_cents: 10000000,
          earned_value_cents: 1000000,
          previously_billed_cents: 0,
          retainage_percent: 10,
          retainage_cents: 100000,
          stored_materials_cents: 0,
          current_due_cents: 900000,
          notes: '',
          created_at_token: 'x',
          updated_at_token: 'x',
        },
      ]);
    getProgressMock.mockResolvedValueOnce({
      projectId: UUID,
      displayId: 'ASC-0001',
      contractValueCents: 10000000,
      currentContractValueCents: 10000000,
      earnedValueCents: 1000000,
    } as never);

    const response = await POST(postRequest({ billingPeriodId: UUID }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.application.currentDueCents).toBe(900000);
  });

  it('maps duplicate applications to 409', async () => {
    queryMock
      .mockResolvedValueOnce([
        { id: 'period-1', project_id: UUID, period_number: 1, status: 'open' },
      ])
      .mockResolvedValueOnce([{ id: 'app-1' }]);

    const response = await POST(postRequest({ billingPeriodId: UUID }));
    expect(response.status).toBe(409);
  });

  it('rejects bad period ids with 400', async () => {
    const response = await POST(postRequest({ billingPeriodId: 'nope' }));
    expect(response.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
