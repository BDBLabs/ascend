import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { queryMock, transactionMock, configuredMock, principalCanMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  transactionMock: vi.fn(async () => []),
  configuredMock: vi.fn(() => true),
  principalCanMock: vi.fn(() => true),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock, transaction: transactionMock }),
  isDatabaseConfigured: configuredMock,
}));

vi.mock('@/lib/field-api-auth', () => ({
  getFieldPrincipal: () => ({ kind: 'field', organizationId: 'org-1' }),
  fieldPrincipalCan: principalCanMock,
  withFieldContext: async (_principal: unknown, work: () => Promise<unknown>) => work(),
}));

import { GET, POST } from './route';

function getRequest(estimateId?: string) {
  const url = estimateId
    ? `http://localhost/api/field/sketch/save?estimateId=${encodeURIComponent(estimateId)}`
    : 'http://localhost/api/field/sketch/save';
  return new NextRequest(url);
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/field/sketch/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const ELEMENT_A = {
  symbol_id: 'sym-outlet',
  display_name: 'Outlet drop',
  x: 120,
  y: 80,
  unit_price_cents: 12500,
};
const ELEMENT_B = {
  symbol_id: 'sym-panel',
  display_name: 'Panel change',
  x: 300,
  y: 40,
  unit_price_cents: 3400,
};

describe('sketch save GET', () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockClear();
    configuredMock.mockReset();
    configuredMock.mockReturnValue(true);
    principalCanMock.mockReset();
    principalCanMock.mockReturnValue(true);
  });

  it('returns 401 when the principal cannot read estimates', async () => {
    principalCanMock.mockReturnValue(false);

    const response = await GET(getRequest('est-1'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the database is not configured', async () => {
    configuredMock.mockReturnValue(false);

    const response = await GET(getRequest('est-1'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Sketch data unavailable' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 400 when estimateId is missing', async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'estimateId query parameter is required',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns the saved elements for the estimate', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'el-1',
        symbol_id: ELEMENT_A.symbol_id,
        display_name: ELEMENT_A.display_name,
        x: ELEMENT_A.x,
        y: ELEMENT_A.y,
        unit_price_cents: ELEMENT_A.unit_price_cents,
        position: 0,
      },
    ]);

    const response = await GET(getRequest('est-1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.elements).toHaveLength(1);
    expect(payload.elements[0]).toMatchObject({
      symbol_id: 'sym-outlet',
      display_name: 'Outlet drop',
      unit_price_cents: 12500,
    });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('estimate_sketch_elements'), [
      'est-1',
    ]);
  });

  it('returns 503 when the database throws', async () => {
    queryMock.mockRejectedValue(new Error('connection refused'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await GET(getRequest('est-1'));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: 'Failed to load sketch elements' });
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('sketch save POST', () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockClear();
    transactionMock.mockResolvedValue([]);
    configuredMock.mockReset();
    configuredMock.mockReturnValue(true);
    principalCanMock.mockReset();
    principalCanMock.mockReturnValue(true);
  });

  it('returns 401 when the principal cannot prepare estimates', async () => {
    principalCanMock.mockReturnValue(false);

    const response = await POST(postRequest({ estimateId: 'est-1', elements: [] }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the database is not configured', async () => {
    configuredMock.mockReturnValue(false);

    const response = await POST(postRequest({ estimateId: 'est-1', elements: [] }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Sketch save unavailable' });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const response = await POST(postRequest('{oops'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid body' });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('returns 400 when estimateId is missing', async () => {
    const response = await POST(postRequest({ elements: [ELEMENT_A] }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'estimateId is required' });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('returns 400 when elements is not an array', async () => {
    const response = await POST(postRequest({ estimateId: 'est-1', elements: 'nope' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'elements array is required' });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('replaces the sketch in one transaction and reports totals', async () => {
    const response = await POST(
      postRequest({ estimateId: 'est-1', elements: [ELEMENT_A, ELEMENT_B] }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      estimateId: 'est-1',
      elementCount: 2,
      totalCents: 15900,
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(queryMock.mock.calls[0][0]).toContain(
      'DELETE FROM estimate_sketch_elements WHERE estimate_id = $1',
    );
    expect(queryMock.mock.calls[0][1]).toEqual(['est-1']);
    expect(queryMock.mock.calls[1][0]).toContain('INSERT INTO estimate_sketch_elements');
    expect(queryMock.mock.calls[1][1]).toEqual(['est-1', 'sym-outlet', 'Outlet drop', 120, 80, 12500, 0]);
    expect(queryMock.mock.calls[2][1]).toEqual(['est-1', 'sym-panel', 'Panel change', 300, 40, 3400, 1]);
  });

  it('clears all elements when saving an empty array', async () => {
    const response = await POST(postRequest({ estimateId: 'est-2', elements: [] }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      estimateId: 'est-2',
      elementCount: 0,
      totalCents: 0,
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toContain('DELETE FROM estimate_sketch_elements');
  });

  it('returns 503 when the transaction fails', async () => {
    transactionMock.mockRejectedValue(new Error('connection refused'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await POST(postRequest({ estimateId: 'est-1', elements: [ELEMENT_A] }));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: 'Failed to save sketch elements' });
    } finally {
      consoleError.mockRestore();
    }
  });
});
