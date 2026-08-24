import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { queryMock, configuredMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  configuredMock: vi.fn(() => true),
}));

vi.mock('@/lib/db', () => ({
  platformDb: () => ({ query: queryMock }),
  isDatabaseConfigured: configuredMock,
}));

import { GET } from './route';

function request(ticket?: string) {
  const url = ticket
    ? `http://localhost/api/dispatch/track?ticket=${encodeURIComponent(ticket)}`
    : 'http://localhost/api/dispatch/track';
  return new NextRequest(url);
}

describe('dispatch track lookup', () => {
  beforeEach(() => {
    queryMock.mockReset();
    configuredMock.mockReset();
    configuredMock.mockReturnValue(true);
  });

  it('returns 503 when the database is not configured', async () => {
    configuredMock.mockReturnValue(false);

    const response = await GET(request('DT-2026-0001'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Service temporarily unavailable' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the ticket query parameter is missing', async () => {
    const response = await GET(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'ticket query parameter is required' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the lookup finds nothing', async () => {
    queryMock.mockResolvedValue([]);

    const response = await GET(request('DT-2026-9999'));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ ok: false, error: 'Ticket not found.' });
    expect(queryMock).toHaveBeenCalledWith('SELECT lookup_dispatch_ticket($1) AS result', [
      'DT-2026-9999',
    ]);
  });

  it('returns 404 with the stored error when the lookup reports failure', async () => {
    queryMock.mockResolvedValue([{ result: { ok: false, error: 'Ticket has been voided.' } }]);

    const response = await GET(request('DT-2026-0000'));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ ok: false, error: 'Ticket has been voided.' });
  });

  it('returns the ticket summary for a valid ticket', async () => {
    queryMock.mockResolvedValue([
      {
        result: {
          ok: true,
          ticketNumber: 'DT-2026-0001',
          status: 'scheduled',
          activeStep: 2,
          category: 'electrical',
          createdAt: '2026-08-01T10:00:00.000Z',
        },
      },
    ]);

    const response = await GET(request('DT-2026-0001'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      ticketNumber: 'DT-2026-0001',
      status: 'scheduled',
      activeStep: 2,
      category: 'electrical',
      createdAt: '2026-08-01T10:00:00.000Z',
    });
  });

  it('returns 500 when the database query throws', async () => {
    queryMock.mockRejectedValue(new Error('connection refused'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await GET(request('DT-2026-0001'));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'Failed to look up ticket' });
    } finally {
      consoleError.mockRestore();
    }
  });
});
