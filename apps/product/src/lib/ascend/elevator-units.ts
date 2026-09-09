import 'server-only';

import type { ElevatorUnitInput } from './ascend-contract';
import { validateElevatorUnitInput } from './ascend-contract';
import type { ElevatorUnitRecord } from './ascend-records';
import { mapElevatorUnit } from './ascend-records';
import { db } from '@/lib/db';

export type { ElevatorUnitRecord } from './ascend-records';

export type ElevatorUnitListFilter = {
  /** Units for exactly one building. */
  buildingId?: string;
  limit?: number;
};

type ElevatorUnitRow = Record<string, unknown>;

const UNIT_SELECT = `
  SELECT
    unit.*,
    building.name AS building_name,
    to_json(unit.created_at) AS created_at_token,
    to_json(unit.updated_at) AS updated_at_token
  FROM elevator_units AS unit
  JOIN buildings AS building
    ON building.id = unit.building_id
   AND building.organization_id = unit.organization_id
`;

export async function createElevatorUnit(
  input: ElevatorUnitInput,
): Promise<ElevatorUnitRecord> {
  const errors = validateElevatorUnitInput(input);
  if (errors.length) throw new Error(`Invalid elevator unit: ${errors.join(' ')}`);
  const rows = (await db().query(
    `WITH inserted AS (
       INSERT INTO elevator_units
         (organization_id, building_id, unit_number, elevator_number,
          manufacturer, model, serial_number, elevator_type,
          rated_load_lbs, rated_speed_fpm, stops, floors_served,
          controller_manufacturer, controller_model,
          drive_manufacturer, drive_model,
          door_operator_manufacturer, door_operator_model,
          existing_condition, notes)
       VALUES
         (app_require_organization_id(), $1::uuid, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     )
     SELECT inserted.*, building.name AS building_name
     FROM inserted
     JOIN buildings AS building
       ON building.id = inserted.building_id
      AND building.organization_id = inserted.organization_id`,
    [
      input.buildingId,
      input.unitNumber.trim(),
      input.elevatorNumber?.trim() ?? '',
      input.manufacturer?.trim() ?? '',
      input.model?.trim() ?? '',
      input.serialNumber?.trim() ?? '',
      input.elevatorType ?? '',
      input.ratedLoadLbs ?? null,
      input.ratedSpeedFpm ?? null,
      input.stops ?? null,
      input.floorsServed?.trim() ?? '',
      input.controllerManufacturer?.trim() ?? '',
      input.controllerModel?.trim() ?? '',
      input.driveManufacturer?.trim() ?? '',
      input.driveModel?.trim() ?? '',
      input.doorOperatorManufacturer?.trim() ?? '',
      input.doorOperatorModel?.trim() ?? '',
      input.existingCondition?.trim() ?? '',
      input.notes?.trim() ?? '',
    ],
  )) as ElevatorUnitRow[];
  const row = rows[0];
  if (!row) throw new Error('Elevator unit insert returned no row.');
  return mapElevatorUnit(row);
}

export async function getElevatorUnit(id: string): Promise<ElevatorUnitRecord | null> {
  const rows = (await db().query(`${UNIT_SELECT} WHERE unit.id = $1 LIMIT 1`, [
    id,
  ])) as ElevatorUnitRow[];
  return rows[0] ? mapElevatorUnit(rows[0]) : null;
}

export async function listElevatorUnits(
  filter: ElevatorUnitListFilter = {},
): Promise<ElevatorUnitRecord[]> {
  const buildingId = filter.buildingId ?? null;
  const rawLimit = filter.limit ?? 50;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
    : 50;
  const rows = (await db().query(
    `${UNIT_SELECT}
     WHERE ($1::uuid IS NULL OR unit.building_id = $1::uuid)
     ORDER BY unit.unit_number ASC, unit.id
     LIMIT $2`,
    [buildingId, limit],
  )) as ElevatorUnitRow[];
  return rows.map(mapElevatorUnit);
}
