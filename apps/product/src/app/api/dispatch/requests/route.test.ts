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

  it('creates a dispatch ticket and returns its number', async () => {
    queryMock.mockResolvedValueOnce([
      { ticket: { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', ticket_number: 'DT-2026-0007' } },
    ]);

    const response = await POST(postRequest(VALID_BODY));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ ok: true, ticketNumber: 'DT-2026-0007' });
    expect(queryMock).toHaveBeenCalledWith('SELECT create_dispatch_ticket($1, $2, $3, $4, $5, $6, $7, $8) AS ticket', [
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
