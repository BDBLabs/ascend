import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

const { queryMock, configuredMock, tenantMock, rateLimitMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  configuredMock: vi.fn(() => true),
  tenantMock: vi.fn(),
  rateLimitMock: vi.fn(async () => true),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
  isDatabaseConfigured: configuredMock,
}));

vi.mock('@/lib/redis-rate-limit', () => ({ rateLimitWithFallback: rateLimitMock }));

vi.mock('@/lib/tenant', () => {
  class TenantResolutionError extends Error {}
  return { TenantResolutionError, withTenant: tenantMock };
});

import { GET } from './route';
import { TenantResolutionError } from '@/lib/tenant';

const TOKEN = 'a'.repeat(43);

function request(token?: string) {
  const url = token !== undefined
    ? `http://localhost/api/dispatch/track?token=${encodeURIComponent(token)}`
    : 'http://localhost/api/dispatch/track';
  return new NextRequest(url);
}

describe('dispatch track lookup', () => {
  beforeEach(() => {
    queryMock.mockReset();
    configuredMock.mockReset();
    configuredMock.mockReturnValue(true);
    rateLimitMock.mockResolvedValue(true);
    tenantMock.mockReset();
    tenantMock.mockImplementation(async (work: (tenant: unknown) => Promise<unknown>) =>
      work({ organizationId: 'org-1' }));
  });

  it('returns 503 when the database is not configured', async () => {
    configuredMock.mockReturnValue(false);
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(503);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the token is missing', async () => {
    const response = await GET(request());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'token query parameter is required' });
  });

  it('does not accept the short ticket number as a lookup key', async () => {
    const response = await GET(request('DRQ-000001'));
    expect(response.status).toBe(404);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rate limits lookups', async () => {
    rateLimitMock.mockResolvedValue(false);
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(429);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('looks up by token hash inside the tenant context', async () => {
    queryMock.mockResolvedValue([{ result: { ok: false, error: 'Ticket not found.' } }]);
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(404);
    expect(tenantMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith('SELECT lookup_dispatch_ticket($1) AS result', [
      createHash('sha256').update(TOKEN).digest('hex'),
    ]);
  });

  it('returns progress without contact details', async () => {
    queryMock.mockResolvedValue([{
      result: {
        ok: true,
        ticketNumber: 'DRQ-000001',
        status: 'reviewing',
        activeStep: 1,
        category: 'electrical',
        priority: 'urgent',
        workSummary: 'Panel buzzing',
        createdAt: '2026-08-01T10:00:00.000Z',
        contactName: 'should never be echoed',
      },
    }]);
    const response = await GET(request(TOKEN));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      ticketNumber: 'DRQ-000001',
      status: 'reviewing',
      activeStep: 1,
      category: 'electrical',
      priority: 'urgent',
      workSummary: 'Panel buzzing',
      createdAt: '2026-08-01T10:00:00.000Z',
    });
  });

  it('answers not-found on a host that is not a tenant', async () => {
    tenantMock.mockRejectedValue(new TenantResolutionError('platform-host' as never));
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(404);
  });

  it('returns 500 when the database query throws', async () => {
    queryMock.mockRejectedValue(new Error('connection refused'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(request(TOKEN));
      expect(response.status).toBe(500);
    } finally {
      consoleError.mockRestore();
    }
  });
});
