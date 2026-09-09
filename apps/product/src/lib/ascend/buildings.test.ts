import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
}));

import { createBuilding, getBuilding, listBuildings } from './buildings';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

function buildingRow() {
  return {
    id: 'building-1',
    customer_id: UUID,
    customer_name: 'Acme Realty',
    name: 'One Court Square',
    address: '1 Court Sq',
    city: 'Long Island City',
    state: 'NY',
    postal_code: '11101',
    primary_contact: 'Jane Doe',
    contact_phone: '555-0100',
    contact_email: 'jane@acme.example',
    notes: '',
    created_at_token: '2026-09-01T09:00:00.000Z',
    updated_at_token: '2026-09-02T09:00:00.000Z',
  };
}

describe('createBuilding', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('inserts with the tenant default and maps the joined customer name', async () => {
    queryMock.mockResolvedValueOnce([buildingRow()]);

    const result = await createBuilding({
      customerId: UUID,
      name: '  One Court Square  ',
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO buildings');
    expect(sql).toContain('app_require_organization_id()');
    expect(sql).toContain('customer.organization_id = inserted.organization_id');
    expect(params[0]).toBe(UUID);
    expect(params[1]).toBe('One Court Square');
    expect(result).toMatchObject({
      id: 'building-1',
      customerId: UUID,
      customerName: 'Acme Realty',
      name: 'One Court Square',
    });
  });

  it('throws without touching the database when input is invalid', async () => {
    await expect(
      createBuilding({ customerId: 'bad', name: 'X' }),
    ).rejects.toThrow('Invalid building');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('throws when the insert returns no row (e.g. unknown customer FK)', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(
      createBuilding({ customerId: UUID, name: 'One Court Square' }),
    ).rejects.toThrow('Building insert returned no row.');
  });
});

describe('getBuilding', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns null when the building is absent or in another tenant', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(getBuilding('missing')).resolves.toBeNull();
  });
});

describe('listBuildings', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('scopes by customer and bounds the limit', async () => {
    queryMock.mockResolvedValueOnce([buildingRow()]);
    const result = await listBuildings({ customerId: UUID, limit: 500 });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('building.customer_id = $1::uuid');
    expect(params).toEqual([UUID, 100]);
    expect(result).toHaveLength(1);
  });
});
