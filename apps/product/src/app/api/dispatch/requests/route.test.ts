import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

const { queryMock, configuredMock, hostMock, tenantMock, rateLimitMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  configuredMock: vi.fn(() => true),
  hostMock: vi.fn(() => 'paris.usejbox.com'),
  tenantMock: vi.fn(),
  rateLimitMock: vi.fn(async () => true),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
  isDatabaseConfigured: configuredMock,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: hostMock() }),
}));

vi.mock('@/lib/redis-rate-limit', () => ({ rateLimitWithFallback: rateLimitMock }));

vi.mock('@/lib/tenant', () => {
  class TenantResolutionError extends Error {}
  return { TenantResolutionError, withTenant: tenantMock };
});

import { POST } from './route';

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/dispatch/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID_BODY = {
  category: 'electrical',
  workRequired: 'Panel upgrade and new circuits for the kitchen remodel.',
  siteLocation: '1420 Alder St',
};

describe('dispatch ticket creation', () => {
  beforeEach(() => {
    queryMock.mockReset();
    configuredMock.mockReset();
    configuredMock.mockReturnValue(true);
    hostMock.mockReturnValue('paris.usejbox.com');
    rateLimitMock.mockResolvedValue(true);
    tenantMock.mockReset();
    tenantMock.mockImplementation(async (work: (tenant: unknown) => Promise<unknown>) =>
      work({ organizationId: 'org-1' }));
  });

  it('refuses intake on a non-tenant host before reading the body', async () => {
    hostMock.mockReturnValue('usejbox.com');
    const response = await POST(postRequest(VALID_BODY));
    expect(response.status).toBe(404);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rate limits intake by client address', async () => {
    rateLimitMock.mockResolvedValue(false);
    const response = await POST(postRequest(VALID_BODY));
    expect(response.status).toBe(429);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the database is not configured', async () => {
    configuredMock.mockReturnValue(false);

    const response = await POST(postRequest(VALID_BODY));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Service temporarily unavailable' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const response = await POST(postRequest('{not json'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the category is missing or not in the allowed set', async () => {
    for (const category of [undefined, 'roofing', 42]) {
      const response = await POST(postRequest({ ...VALID_BODY, category }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Valid category is required (electrical, plumbing, hvac, general)',
      });
    }
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 400 when workRequired is missing', async () => {
    const response = await POST(postRequest({ category: 'plumbing' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'workRequired is required (max 4000 chars)',
    });
  });

  it('returns 400 when workRequired is empty after trimming', async () => {
    const response = await POST(postRequest({ ...VALID_BODY, workRequired: '   ' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'workRequired is required (max 4000 chars)',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 400 when workRequired exceeds 4000 characters', async () => {
    const response = await POST(
      postRequest({ ...VALID_BODY, workRequired: 'x'.repeat(4001) }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'workRequired is required (max 4000 chars)',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 400 when siteLocation exceeds 500 characters', async () => {
    const response = await POST(
      postRequest({ ...VALID_BODY, siteLocation: 'y'.repeat(501) }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'siteLocation must be at most 500 chars',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('creates a tenant-bound ticket and returns a one-time tracking token', async () => {
    queryMock.mockResolvedValueOnce([
      { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', ticket_number: 'DRQ-000007' },
    ]);

    const response = await POST(postRequest(VALID_BODY));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.ticketNumber).toBe('DRQ-000007');
    expect(payload.trackingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload).not.toHaveProperty('ticketId');
    expect(tenantMock).toHaveBeenCalledTimes(1);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe('SELECT id, ticket_number FROM create_dispatch_ticket($1, $2, $3, $4, $5, $6, $7, $8, $9)');
    // Only the token's hash reaches the database.
    expect(params[0]).toBe(createHash('sha256').update(payload.trackingToken).digest('hex'));
    expect(params.slice(1)).toEqual([
      VALID_BODY.category,
      VALID_BODY.workRequired,
      VALID_BODY.siteLocation,
      '',
      '',
      '',
      'normal',
      null,
    ]);
  });

  it('returns 500 when the database throws', async () => {
    queryMock.mockRejectedValue(new Error('connection refused'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await POST(postRequest(VALID_BODY));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'Failed to create dispatch ticket' });
    } finally {
      consoleError.mockRestore();
    }
  });
});
