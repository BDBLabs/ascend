import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
}));

import {
  createElevatorUnit,
  getElevatorUnit,
  listElevatorUnits,
} from './elevator-units';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

function unitRow() {
  return {
    id: 'unit-1',
    building_id: UUID,
    building_name: 'One Court Square',
    unit_number: 'CAR-1',
    elevator_number: 'E-01',
    manufacturer: 'Otis',
    model: 'Gen2',
    serial_number: 'SN-123',
    elevator_type: 'traction',
    rated_load_lbs: 3500,
    rated_speed_fpm: 500,
    stops: 12,
    floors_served: '1-12',
    controller_manufacturer: 'Otis',
    controller_model: 'OCSS',
    drive_manufacturer: 'Otis',
    drive_model: 'ReGen',
    door_operator_manufacturer: 'Otis',
    door_operator_model: 'DO-1',
    existing_condition: 'Worn ropes',
    notes: '',
    created_at_token: '2026-09-01T09:00:00.000Z',
    updated_at_token: '2026-09-02T09:00:00.000Z',
  };
}

describe('createElevatorUnit', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('inserts with tenant default and maps the joined building name', async () => {
    queryMock.mockResolvedValueOnce([unitRow()]);

    const result = await createElevatorUnit({
      buildingId: UUID,
      unitNumber: 'CAR-1',
      elevatorType: 'traction',
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO elevator_units');
    expect(sql).toContain('app_require_organization_id()');
    expect(sql).toContain('building.organization_id = inserted.organization_id');
    expect(params[0]).toBe(UUID);
    expect(result).toMatchObject({
      id: 'unit-1',
      buildingId: UUID,
      buildingName: 'One Court Square',
      elevatorType: 'traction',
      ratedLoadLbs: 3500,
    });
  });

  it('throws without touching the database when input is invalid', async () => {
    await expect(
      createElevatorUnit({ buildingId: UUID, unitNumber: '' }),
    ).rejects.toThrow('Invalid elevator unit');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('getElevatorUnit', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns null when absent', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(getElevatorUnit('missing')).resolves.toBeNull();
  });
});

describe('listElevatorUnits', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('scopes by building and orders by unit number', async () => {
    queryMock.mockResolvedValueOnce([unitRow()]);
    const result = await listElevatorUnits({ buildingId: UUID });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('unit.building_id = $1::uuid');
    expect(sql).toContain('ORDER BY unit.unit_number ASC');
    expect(params).toEqual([UUID, 50]);
    expect(result).toHaveLength(1);
  });
});
