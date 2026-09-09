import 'server-only';

import type { BuildingInput } from './ascend-contract';
import { validateBuildingInput } from './ascend-contract';
import type { BuildingRecord } from './ascend-records';
import { mapBuilding } from './ascend-records';
import { db } from '@/lib/db';

export type { BuildingRecord } from './ascend-records';

export type BuildingListFilter = {
  /** Buildings for exactly one customer. */
  customerId?: string;
  limit?: number;
};

type BuildingRow = Record<string, unknown>;

const BUILDING_SELECT = `
  SELECT
    building.*,
    customer.display_name AS customer_name,
    to_json(building.created_at) AS created_at_token,
    to_json(building.updated_at) AS updated_at_token
  FROM buildings AS building
  JOIN customers AS customer
    ON customer.id = building.customer_id
   AND customer.organization_id = building.organization_id
`;

export async function createBuilding(input: BuildingInput): Promise<BuildingRecord> {
  const errors = validateBuildingInput(input);
  if (errors.length) throw new Error(`Invalid building: ${errors.join(' ')}`);
  const rows = (await db().query(
    `WITH inserted AS (
       INSERT INTO buildings
         (organization_id, customer_id, name, address, city, state,
          postal_code, primary_contact, contact_phone, contact_email, notes)
       VALUES
         (app_require_organization_id(), $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     )
     SELECT inserted.*, customer.display_name AS customer_name
     FROM inserted
     JOIN customers AS customer
       ON customer.id = inserted.customer_id
      AND customer.organization_id = inserted.organization_id`,
    [
      input.customerId,
      input.name.trim(),
      input.address?.trim() ?? '',
      input.city?.trim() ?? '',
      input.state?.trim() ?? '',
      input.postalCode?.trim() ?? '',
      input.primaryContact?.trim() ?? '',
      input.contactPhone?.trim() ?? '',
      input.contactEmail?.trim() ?? '',
      input.notes?.trim() ?? '',
    ],
  )) as BuildingRow[];
  const row = rows[0];
  if (!row) throw new Error('Building insert returned no row.');
  return mapBuilding(row);
}

export async function getBuilding(id: string): Promise<BuildingRecord | null> {
  const rows = (await db().query(`${BUILDING_SELECT} WHERE building.id = $1 LIMIT 1`, [
    id,
  ])) as BuildingRow[];
  return rows[0] ? mapBuilding(rows[0]) : null;
}

export async function listBuildings(
  filter: BuildingListFilter = {},
): Promise<BuildingRecord[]> {
  const customerId = filter.customerId ?? null;
  const rawLimit = filter.limit ?? 50;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
    : 50;
  const rows = (await db().query(
    `${BUILDING_SELECT}
     WHERE ($1::uuid IS NULL OR building.customer_id = $1::uuid)
     ORDER BY building.updated_at DESC, building.id
     LIMIT $2`,
    [customerId, limit],
  )) as BuildingRow[];
  return rows.map(mapBuilding);
}
