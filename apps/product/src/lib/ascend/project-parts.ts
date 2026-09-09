import 'server-only';

import type {
  PartQuantityInput,
  PartStatus,
  ProjectPartInput,
} from './project-part-contract';
import {
  canTransitionPartStatus,
  isPartStatus,
  validatePartInput,
  validatePartQuantity,
} from './project-part-contract';
import type { ProjectPartRecord } from './ascend-records';
import { mapProjectPart } from './ascend-records';
import { db } from '@/lib/db';
import { requireOrganizationContext } from '@/lib/organization-context-store';

export type { ProjectPartRecord } from './ascend-records';

export type ProjectPartListFilter = {
  projectId?: string;
  status?: PartStatus;
  workPackageId?: string;
  elevatorUnitId?: string;
  inventoryItemId?: string;
  limit?: number;
};

type ProjectPartRow = Record<string, unknown>;

const PART_SELECT = `
  SELECT
    part.*,
    project.display_id AS project_display_id,
    unit.unit_number AS elevator_unit_number,
    package.name AS work_package_name,
    item.code AS inventory_item_code,
    to_json(part.created_at) AS created_at_token,
    to_json(part.updated_at) AS updated_at_token
  FROM project_parts AS part
  JOIN modernization_projects AS project
    ON project.id = part.project_id
   AND project.organization_id = part.organization_id
  LEFT JOIN elevator_units AS unit
    ON unit.id = part.elevator_unit_id
   AND unit.organization_id = part.organization_id
  LEFT JOIN work_packages AS package
    ON package.id = part.work_package_id
   AND package.organization_id = part.organization_id
  LEFT JOIN inventory_items AS item
    ON item.id = part.inventory_item_id
   AND item.organization_id = part.organization_id
`;

export async function createProjectPart(
  input: ProjectPartInput,
): Promise<ProjectPartRecord> {
  const errors = validatePartInput(input);
  if (errors.length) throw new Error(`Invalid project part: ${errors.join(' ')}`);
  const actorId = requireOrganizationContext().actorId;
  const rows = (await db().query(
    `WITH inserted AS (
       INSERT INTO project_parts
         (organization_id, project_id, building_id, elevator_unit_id,
          work_package_id, inventory_item_id, description,
          quantity_required_hundredths, planned_cost_cents, actual_cost_cents,
          supplier, source_ref, needed_date, notes)
       VALUES
         (app_require_organization_id(), $1::uuid, $2::uuid, $3::uuid,
          $4::uuid, $5::uuid, $6, $7, $8, $9, $10, $11, $12::date, $13)
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     ),
     event AS (
       INSERT INTO project_part_events
         (organization_id, project_part_id, event, actor_id, meta)
       SELECT app_require_organization_id(), inserted.id, 'created',
              $14::uuid, '{}'::jsonb
       FROM inserted
     )
     SELECT inserted.*,
            project.display_id AS project_display_id,
            unit.unit_number AS elevator_unit_number,
            package.name AS work_package_name,
            item.code AS inventory_item_code
     FROM inserted
     JOIN modernization_projects AS project
       ON project.id = inserted.project_id
      AND project.organization_id = inserted.organization_id
     LEFT JOIN elevator_units AS unit
       ON unit.id = inserted.elevator_unit_id
      AND unit.organization_id = inserted.organization_id
     LEFT JOIN work_packages AS package
       ON package.id = inserted.work_package_id
      AND package.organization_id = inserted.organization_id
     LEFT JOIN inventory_items AS item
       ON item.id = inserted.inventory_item_id
      AND item.organization_id = inserted.organization_id`,
    [
      input.projectId,
      input.buildingId ?? null,
      input.elevatorUnitId ?? null,
      input.workPackageId ?? null,
      input.inventoryItemId ?? null,
      input.description.trim(),
      input.quantityRequiredHundredths,
      input.plannedCostCents ?? 0,
      input.actualCostCents ?? 0,
      input.supplier?.trim() ?? '',
      input.sourceRef?.trim() ?? '',
      input.neededDate ?? null,
      input.notes?.trim() ?? '',
      actorId,
    ],
  )) as ProjectPartRow[];
  const row = rows[0];
  if (!row) throw new Error('Project part insert returned no row.');
  return mapProjectPart(row);
}

export async function getProjectPart(id: string): Promise<ProjectPartRecord | null> {
  const rows = (await db().query(`${PART_SELECT} WHERE part.id = $1 LIMIT 1`, [
    id,
  ])) as ProjectPartRow[];
  return rows[0] ? mapProjectPart(rows[0]) : null;
}

export async function listProjectParts(
  filter: ProjectPartListFilter = {},
): Promise<ProjectPartRecord[]> {
  const projectId = filter.projectId ?? null;
  const status = filter.status ?? null;
  const workPackageId = filter.workPackageId ?? null;
  const elevatorUnitId = filter.elevatorUnitId ?? null;
  const inventoryItemId = filter.inventoryItemId ?? null;
  if (status !== null && !isPartStatus(status)) {
    throw new Error(`Invalid part status filter: ${status}.`);
  }
  const rawLimit = filter.limit ?? 50;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
    : 50;
  const rows = (await db().query(
    `${PART_SELECT}
     WHERE ($1::uuid IS NULL OR part.project_id = $1::uuid)
       AND ($2::text IS NULL OR part.status = $2::text)
       AND ($3::uuid IS NULL OR part.work_package_id = $3::uuid)
       AND ($4::uuid IS NULL OR part.elevator_unit_id = $4::uuid)
       AND ($5::uuid IS NULL OR part.inventory_item_id = $5::uuid)
     ORDER BY part.needed_date ASC NULLS LAST, part.created_at ASC, part.id
     LIMIT $6`,
    [projectId, status, workPackageId, elevatorUnitId, inventoryItemId, limit],
  )) as ProjectPartRow[];
  return rows.map(mapProjectPart);
}

export type UpdatePartStatusResult =
  | { ok: true; part: ProjectPartRecord }
  | { ok: false; error: 'part-not-found' | 'invalid-transition' };

export async function updatePartStatus(
  partId: string,
  toStatus: PartStatus,
  note?: string,
): Promise<UpdatePartStatusResult> {
  if (!isPartStatus(toStatus)) {
    return { ok: false, error: 'invalid-transition' };
  }
  const actorId = requireOrganizationContext().actorId;
  const sql = db();
  const current = (await sql.query(
    `SELECT status FROM project_parts WHERE id = $1::uuid LIMIT 1`,
    [partId],
  )) as Array<{ status: PartStatus }>;
  const from = current[0]?.status;
  if (!from) return { ok: false, error: 'part-not-found' };
  if (!canTransitionPartStatus(from, toStatus)) {
    return { ok: false, error: 'invalid-transition' };
  }
  if (from === toStatus) {
    const unchanged = await getProjectPart(partId);
    if (!unchanged) return { ok: false, error: 'part-not-found' };
    return { ok: true, part: unchanged };
  }
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE project_parts
       SET status = $2, updated_at = now()
       WHERE id = $1::uuid
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     ),
     event AS (
       INSERT INTO project_part_events
         (organization_id, project_part_id, event, actor_id, meta)
       SELECT app_require_organization_id(), updated.id, 'status_changed',
              $3::uuid,
              jsonb_build_object(
                'from_status', $4, 'to_status', $2,
                'note', COALESCE($5, '')
              )
       FROM updated
     )
     SELECT updated.*,
            project.display_id AS project_display_id,
            unit.unit_number AS elevator_unit_number,
            package.name AS work_package_name,
            item.code AS inventory_item_code
     FROM updated
     JOIN modernization_projects AS project
       ON project.id = updated.project_id
      AND project.organization_id = updated.organization_id
     LEFT JOIN elevator_units AS unit
       ON unit.id = updated.elevator_unit_id
      AND unit.organization_id = updated.organization_id
     LEFT JOIN work_packages AS package
       ON package.id = updated.work_package_id
      AND package.organization_id = updated.organization_id
     LEFT JOIN inventory_items AS item
       ON item.id = updated.inventory_item_id
      AND item.organization_id = updated.organization_id`,
    [partId, toStatus, actorId, from, note?.trim() ?? null],
  )) as ProjectPartRow[];
  const row = rows[0];
  if (!row) return { ok: false, error: 'part-not-found' };
  return { ok: true, part: mapProjectPart(row) };
}

export type RecordPartQuantityResult =
  | { ok: true; part: ProjectPartRecord }
  | { ok: false; error: 'part-not-found' | 'invalid' };

/**
 * Records receiving / installation progress and posted cost against a
 * part. Quantities only move upward here — a miscount is corrected by a
 * compensating note, not by rewriting history.
 */
export async function recordPartQuantity(
  partId: string,
  input: PartQuantityInput,
): Promise<RecordPartQuantityResult> {
  const errors = validatePartQuantity(input);
  if (errors.length) return { ok: false, error: 'invalid' };
  const actorId = requireOrganizationContext().actorId;
  const sql = db();
  const current = (await sql.query(
    `SELECT quantity_received_hundredths, quantity_installed_hundredths,
            actual_cost_cents
     FROM project_parts WHERE id = $1::uuid LIMIT 1`,
    [partId],
  )) as Array<{
    quantity_received_hundredths: number;
    quantity_installed_hundredths: number;
    actual_cost_cents: number;
  }>;
  const from = current[0];
  if (!from) return { ok: false, error: 'part-not-found' };
  const toReceived =
    input.quantityReceivedHundredths ?? Number(from.quantity_received_hundredths);
  const toInstalled =
    input.quantityInstalledHundredths ?? Number(from.quantity_installed_hundredths);
  const toCost = input.actualCostCents ?? Number(from.actual_cost_cents);
  if (
    toReceived < Number(from.quantity_received_hundredths) ||
    toInstalled < Number(from.quantity_installed_hundredths) ||
    toCost < Number(from.actual_cost_cents)
  ) {
    return { ok: false, error: 'invalid' };
  }
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE project_parts
       SET quantity_received_hundredths = $2,
           quantity_installed_hundredths = $3,
           actual_cost_cents = $4,
           updated_at = now()
       WHERE id = $1::uuid
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     ),
     event AS (
       INSERT INTO project_part_events
         (organization_id, project_part_id, event, actor_id, meta)
       SELECT app_require_organization_id(), updated.id, 'quantity_updated',
              $5::uuid,
              jsonb_build_object(
                'from_received', $6, 'to_received', $2,
                'from_installed', $7, 'to_installed', $3,
                'from_cost_cents', $8, 'to_cost_cents', $4,
                'note', COALESCE($9, '')
              )
       FROM updated
     )
     SELECT updated.*,
            project.display_id AS project_display_id,
            unit.unit_number AS elevator_unit_number,
            package.name AS work_package_name,
            item.code AS inventory_item_code
     FROM updated
     JOIN modernization_projects AS project
       ON project.id = updated.project_id
      AND project.organization_id = updated.organization_id
     LEFT JOIN elevator_units AS unit
       ON unit.id = updated.elevator_unit_id
      AND unit.organization_id = updated.organization_id
     LEFT JOIN work_packages AS package
       ON package.id = updated.work_package_id
      AND package.organization_id = updated.organization_id
     LEFT JOIN inventory_items AS item
       ON item.id = updated.inventory_item_id
      AND item.organization_id = updated.organization_id`,
    [
      partId,
      toReceived,
      toInstalled,
      toCost,
      actorId,
      Number(from.quantity_received_hundredths),
      Number(from.quantity_installed_hundredths),
      Number(from.actual_cost_cents),
      input.note?.trim() ?? null,
    ],
  )) as ProjectPartRow[];
  const row = rows[0];
  if (!row) return { ok: false, error: 'part-not-found' };
  return { ok: true, part: mapProjectPart(row) };
}
