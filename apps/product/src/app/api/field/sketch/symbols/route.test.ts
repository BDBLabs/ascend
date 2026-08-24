import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, configuredMock, principalCanMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  configuredMock: vi.fn(() => true),
  principalCanMock: vi.fn(() => true),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
  isDatabaseConfigured: configuredMock,
}));

vi.mock('@/lib/field-api-auth', () => ({
  getFieldPrincipal: () => ({ kind: 'field', organizationId: 'org-1' }),
  fieldPrincipalCan: principalCanMock,
  withFieldContext: async (_principal: unknown, work: () => Promise<unknown>) => work(),
}));

import { GET } from './route';

const PRICE_BOOK_ITEM_ID = '16fd2706-8baf-433b-82eb-8c7fada847da';

function paletteRow(overrides: Record<string, unknown> = {}) {
  return {
    symbol_id: 'sym-outlet',
    category: 'outlets',
    display_name: 'Outlet drop',
    icon_svg_path: 'M2 12h20M12 2v20',
    price_book_item_id: PRICE_BOOK_ITEM_ID,
    price_book_name: 'Duplex receptacle, 20A',
    unit_price_cents: 12500,
    ...overrides,
  };
}

describe('sketch canvas symbols', () => {
  beforeEach(() => {
    queryMock.mockReset();
    configuredMock.mockReset();
    configuredMock.mockReturnValue(true);
    principalCanMock.mockReset();
    principalCanMock.mockReturnValue(true);
  });

  it('returns 401 when the principal cannot read estimates', async () => {
    principalCanMock.mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the database is not configured', async () => {
    configuredMock.mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Sketch symbols unavailable' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns the trade-scoped palette with price book data', async () => {
    queryMock
      .mockResolvedValueOnce([{ trade_category: 'electrical' }])
      .mockResolvedValueOnce([
        paletteRow(),
        paletteRow({
          symbol_id: 'sym-panel',
          category: 'panel',
          display_name: 'Panel change',
          icon_svg_path: 'M4 4h16v16H4z',
          price_book_item_id: null,
          price_book_name: null,
          unit_price_cents: null,
        }),
      ]);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.organizationId).toBe('org-1');
    expect(payload.tradeCategory).toBe('electrical');
    expect(payload.palette).toHaveLength(2);
    expect(payload.palette[0]).toMatchObject({
      symbol_id: 'sym-outlet',
      display_name: 'Outlet drop',
      price_book_item_id: PRICE_BOOK_ITEM_ID,
      unit_price_cents: 12500,
    });
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      'SELECT trade_category FROM organizations WHERE id = $1',
      ['org-1'],
    );
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('returns symbols without a price book binding as unpriced', async () => {
    queryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        paletteRow({
          symbol_id: 'sym-panel',
          display_name: 'Panel change',
          price_book_item_id: null,
          price_book_name: null,
          unit_price_cents: null,
        }),
      ]);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tradeCategory).toBe('general');
    expect(payload.palette[0]).toMatchObject({
      symbol_id: 'sym-panel',
      price_book_item_id: null,
      unit_price_cents: null,
    });
  });

  it('returns 503 when the database throws', async () => {
    queryMock.mockRejectedValue(new Error('connection refused'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await GET();

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: 'Failed to load sketch symbols' });
    } finally {
      consoleError.mockRestore();
    }
  });
});
