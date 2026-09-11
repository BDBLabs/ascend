import 'server-only';

import type {
  ModernizationProjectInput,
  ProjectStatus,
} from './ascend-contract';
import { isProjectStatus, validateProjectInput } from './ascend-contract';
import type { ModernizationProjectRecord } from './ascend-records';
import { mapModernizationProject } from './ascend-records';
import { db } from '@/lib/db';

export type { ModernizationProjectRecord } from './ascend-records';

export type ModernizationProjectListFilter = {
  customerId?: string;
  buildingId?: string;
  status?: ProjectStatus;
  limit?: number;
};

type ProjectRow = Record<string, unknown>;

/**
 * Project detail with its linked elevator units. The unit list is aggregated
 * in one query so callers never need a second round trip; RLS still scopes
 * every joined row to the caller's organization.
 */
const PROJECT_SELECT = `
  SELECT
    project.*,
    customer.display_name AS customer_name,
    building.name AS building_name,
    estimate.display_id AS estimate_display_id,
    COALESCE(
      (SELECT array_agg(link.elevator_unit_id)
       FROM project_elevators AS link
       WHERE link.project_id = project.id
         AND link.organization_id = project.organization_id),
      '{}'
    ) AS elevator_unit_ids,
    to_json(project.created_at) AS created_at_token,
    to_json(project.updated_at) AS updated_at_token
  FROM modernization_projects AS project
  JOIN customers AS customer
    ON customer.id = project.customer_id
   AND customer.organization_id = project.organization_id
  LEFT JOIN buildings AS building
    ON building.id = project.building_id
   AND building.organization_id = project.organization_id
  LEFT JOIN estimates AS estimate
    ON estimate.id = project.estimate_id
   AND estimate.organization_id = project.organization_id
`;

export async function createModernizationProject(
  input: ModernizationProjectInput,
): Promise<ModernizationProjectRecord> {
  const errors = validateProjectInput(input);
  if (errors.length) throw new Error(`Invalid project: ${errors.join(' ')}`);
  const rows = (await db().query(
    `WITH inserted AS (
       INSERT INTO modernization_projects
         (organization_id, display_id, customer_id, building_id, status,
          contract_value_cents, project_manager,
          start_date, target_completion_date, actual_completion_date, notes)
       VALUES
         (app_require_organization_id(), $1, $2::uuid, $3::uuid, $4,
          $5, $6, $7::date, $8::date, $9::date, $10)
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     )
     SELECT inserted.*,
            customer.display_name AS customer_name,
            building.name AS building_name,
            NULL AS estimate_display_id,
            '{}' AS elevator_unit_ids
     FROM inserted
     JOIN customers AS customer
       ON customer.id = inserted.customer_id
      AND customer.organization_id = inserted.organization_id
     LEFT JOIN buildings AS building
       ON building.id = inserted.building_id
      AND building.organization_id = inserted.organization_id`,
    [
      input.displayId,
      input.customerId,
      input.buildingId ?? null,
      input.status ?? 'prospect',
      input.contractValueCents ?? 0,
      input.projectManager?.trim() ?? '',
      input.startDate ?? null,
      input.targetCompletionDate ?? null,
      input.actualCompletionDate ?? null,
      input.notes?.trim() ?? '',
    ],
  )) as ProjectRow[];
  const row = rows[0];
  if (!row) throw new Error('Project insert returned no row.');
  return mapModernizationProject(row);
}

export async function getModernizationProject(
  id: string,
): Promise<ModernizationProjectRecord | null> {
  const rows = (await db().query(`${PROJECT_SELECT} WHERE project.id = $1 LIMIT 1`, [
    id,
  ])) as ProjectRow[];
  return rows[0] ? mapModernizationProject(rows[0]) : null;
}

export async function listModernizationProjects(
  filter: ModernizationProjectListFilter = {},
): Promise<ModernizationProjectRecord[]> {
  const customerId = filter.customerId ?? null;
  const buildingId = filter.buildingId ?? null;
  const status = filter.status ?? null;
  if (status !== null && !isProjectStatus(status)) {
    throw new Error(`Invalid project status filter: ${status}.`);
  }
  const rawLimit = filter.limit ?? 50;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
    : 50;
  const rows = (await db().query(
    `${PROJECT_SELECT}
     WHERE ($1::uuid IS NULL OR project.customer_id = $1::uuid)
       AND ($2::uuid IS NULL OR project.building_id = $2::uuid)
       AND ($3::text IS NULL OR project.status = $3::text)
     ORDER BY project.updated_at DESC, project.id
     LIMIT $4`,
    [customerId, buildingId, status, limit],
  )) as ProjectRow[];
  return rows.map(mapModernizationProject);
}

export type ProjectElevatorLinkResult =
  | { ok: true; projectId: string; elevatorUnitId: string }
  | { ok: false; error: 'project-not-found' | 'unit-not-found' | 'already-linked' };

/**
 * Links an elevator unit to a project. Verifies both rows exist in the
 * caller's organization first so a cross-tenant id can never link
 * silently; the UNIQUE(project_id, elevator_unit_id) constraint is the
 * final guard and surfaces as already-linked.
 */
export async function linkElevatorToProject(
  projectId: string,
  elevatorUnitId: string,
): Promise<ProjectElevatorLinkResult> {
  const sql = db();
  const projectRows = (await sql.query(
    `SELECT id FROM modernization_projects WHERE id = $1::uuid LIMIT 1`,
    [projectId],
  )) as Array<Record<string, unknown>>;
  if (!projectRows[0]) return { ok: false, error: 'project-not-found' };
  const unitRows = (await sql.query(
    `SELECT id FROM elevator_units WHERE id = $1::uuid LIMIT 1`,
    [elevatorUnitId],
  )) as Array<Record<string, unknown>>;
  if (!unitRows[0]) return { ok: false, error: 'unit-not-found' };
  try {
    await sql.query(
      `INSERT INTO project_elevators
         (organization_id, project_id, elevator_unit_id)
       VALUES (app_require_organization_id(), $1::uuid, $2::uuid)`,
      [projectId, elevatorUnitId],
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /duplicate key|unique/i.test(error.message)
    ) {
      return { ok: false, error: 'already-linked' };
    }
    throw error;
  }
  return { ok: true, projectId, elevatorUnitId };
}

export async function unlinkElevatorFromProject(
  projectId: string,
  elevatorUnitId: string,
): Promise<boolean> {
  const rows = (await db().query(
    `DELETE FROM project_elevators
     WHERE project_id = $1::uuid AND elevator_unit_id = $2::uuid
     RETURNING id`,
    [projectId, elevatorUnitId],
  )) as Array<Record<string, unknown>>;
  return rows.length > 0;
}
