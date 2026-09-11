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

const UUID = '550e8400-e29b-41d4-a716-446655440000';

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ascend/obligations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ascend/obligations', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('creates an obligation and returns 201', async () => {
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
    const response = await POST(
      postRequest({ projectId: UUID, title: 'Maintain service' }),
    );
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.obligation.title).toBe('Maintain service');
  });

  it('rejects invalid input with 400', async () => {
    const response = await POST(postRequest({ projectId: UUID, title: 'X' }));
    expect(response.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
