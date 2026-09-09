import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
  isDatabaseConfigured: () => true,
}));

const { authMock } = vi.hoisted(() => ({
  authMock: { principal: { kind: 'field' } as unknown, can: true },
}));

vi.mock('@/lib/field-api-auth', () => ({
  getFieldPrincipal: () => authMock.principal,
  fieldPrincipalCan: (principal: unknown) =>
    Boolean(principal) && authMock.can,
  withFieldContext: async (_principal: unknown, work: () => Promise<unknown>) =>
    work(),
}));

import { POST } from './route';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

function postRequest(body: unknown, origin = 'http://localhost'): NextRequest {
  return new NextRequest('http://localhost/api/ascend/buildings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ascend/buildings', () => {
  beforeEach(() => {
    queryMock.mockReset();
    authMock.principal = { kind: 'field' } as unknown;
    authMock.can = true;
  });

  it('creates a building and returns 201', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'building-1',
        customer_id: UUID,
        customer_name: 'Acme',
        name: 'Tower',
        address: '',
        city: '',
        state: '',
        postal_code: '',
        primary_contact: '',
        contact_phone: '',
        contact_email: '',
        notes: '',
        created_at_token: '2026-09-01T09:00:00.000Z',
        updated_at_token: '2026-09-01T09:00:00.000Z',
      },
    ]);

    const response = await POST(
      postRequest({ customerId: UUID, name: 'Tower' }),
    );
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.building.name).toBe('Tower');
  });

  it('rejects invalid input with 400 without querying', async () => {
    const response = await POST(postRequest({ customerId: UUID, name: 'X' }));
    expect(response.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers with 401', async () => {
    authMock.principal = null;
    const response = await POST(
      postRequest({ customerId: UUID, name: 'Tower' }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects cross-origin posts with 403', async () => {
    const response = await POST(
      postRequest({ customerId: UUID, name: 'Tower' }, 'https://evil.example'),
    );
    expect(response.status).toBe(403);
  });

  it('maps foreign-key failures to 409', async () => {
    queryMock.mockRejectedValueOnce(
      new Error('insert violates foreign key constraint'),
    );
    const response = await POST(
      postRequest({ customerId: UUID, name: 'Tower' }),
    );
    expect(response.status).toBe(409);
  });
});
