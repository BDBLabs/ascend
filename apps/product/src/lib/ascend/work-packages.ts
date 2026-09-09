import 'server-only';

import type {
  WorkPackageInput,
  WorkPackageProgressInput,
  WorkPackageStatus,
} from './work-package-contract';
import {
  isWorkPackageStatus,
  validateWorkPackageInput,
  validateWorkPackageProgress,
} from './work-package-contract';
import type { WorkPackageRecord } from './ascend-records';
import { mapWorkPackage } from './ascend-records';
import { db } from '@/lib/db';
import { requireOrganizationContext } from '@/lib/organization-context-store';

export type { WorkPackageRecord } from './ascend-records';

export type WorkPackageListFilter = {
  /** Packages for exactly one project. */
  projectId?: string;
  status?: WorkPackageStatus;
  limit?: number;
};

type WorkPackageRow = Record<string, unknown>;

const PACKAGE_SELECT = `
  SELECT
    package.*,
    project.display_id AS project_display_id,
    COALESCE(
      (SELECT array_agg(link.elevator_unit_id)
       FROM work_package_elevators AS link
       WHERE link.work_package_id = package.id
         AND link.organization_id = package.organization_id),
      '{}'
    ) AS elevator_unit_ids,
    to_json(package.created_at) AS created_at_token,
    to_json(package.updated_at) AS updated_at_token
  FROM work_packages AS package
  JOIN modernization_projects AS project
    ON project.id = package.project_id
   AND project.organization_id = package.organization_id
`;

export async function createWorkPackage(
  input: WorkPackageInput,
): Promise<WorkPackageRecord> {
  const errors = validateWorkPackageInput(input);
  if (errors.length) throw new Error(`Invalid work package: ${errors.join(' ')}`);
  const actorId = requireOrganizationContext().actorId;
  const rows = (await db().query(
    `WITH inserted AS (
       INSERT INTO work_packages
         (organization_id, project_id, name, category, description,
          budget_cost_cents, contract_value_cents,
          planned_start, planned_finish, actual_start, actual_finish,
          responsible_person, notes)
       VALUES
         (app_require_organization_id(), $1::uuid, $2, $3, $4,
          $5, $6, $7::date, $8::date, $9::date, $10::date, $11, $12)
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     ),
     event AS (
       INSERT INTO work_package_events
         (organization_id, work_package_id, event, actor_id, meta)
       SELECT app_require_organization_id(), inserted.id, 'created',
              $13::uuid, '{}'::jsonb
       FROM inserted
     )
     SELECT inserted.*,
            project.display_id AS project_display_id,
            '{}' AS elevator_unit_ids
     FROM inserted
     JOIN modernization_projects AS project
       ON project.id = inserted.project_id
      AND project.organization_id = inserted.organization_id`,
    [
      input.projectId,
      input.name.trim(),
      input.category?.trim() ?? '',
      input.description?.trim() ?? '',
      input.budgetCostCents ?? 0,
      input.contractValueCents ?? 0,
      input.plannedStart ?? null,
      input.plannedFinish ?? null,
      input.actualStart ?? null,
      input.actualFinish ?? null,
      input.responsiblePerson?.trim() ?? '',
      input.notes?.trim() ?? '',
      actorId,
    ],
  )) as WorkPackageRow[];
  const row = rows[0];
  if (!row) throw new Error('Work package insert returned no row.');
  return mapWorkPackage(row);
}

export async function getWorkPackage(id: string): Promise<WorkPackageRecord | null> {
  const rows = (await db().query(`${PACKAGE_SELECT} WHERE package.id = $1 LIMIT 1`, [
    id,
  ])) as WorkPackageRow[];
  return rows[0] ? mapWorkPackage(rows[0]) : null;
}

export async function listWorkPackages(
  filter: WorkPackageListFilter = {},
): Promise<WorkPackageRecord[]> {
  const projectId = filter.projectId ?? null;
  const status = filter.status ?? null;
  if (status !== null && !isWorkPackageStatus(status)) {
    throw new Error(`Invalid work package status filter: ${status}.`);
  }
  const rawLimit = filter.limit ?? 50;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
    : 50;
  const rows = (await db().query(
    `${PACKAGE_SELECT}
     WHERE ($1::uuid IS NULL OR package.project_id = $1::uuid)
       AND ($2::text IS NULL OR package.status = $2::text)
     ORDER BY package.created_at ASC, package.id
     LIMIT $3`,
    [projectId, status, limit],
  )) as WorkPackageRow[];
  return rows.map(mapWorkPackage);
}

export type WorkPackageUnitLinkResult =
  | { ok: true; workPackageId: string; elevatorUnitId: string }
  | { ok: false; error: 'package-not-found' | 'unit-not-found' | 'already-linked' };

export async function linkUnitToWorkPackage(
  workPackageId: string,
  elevatorUnitId: string,
): Promise<WorkPackageUnitLinkResult> {
  const sql = db();
  const packageRows = (await sql.query(
    `SELECT id FROM work_packages WHERE id = $1::uuid LIMIT 1`,
    [workPackageId],
  )) as Array<Record<string, unknown>>;
  if (!packageRows[0]) return { ok: false, error: 'package-not-found' };
  const unitRows = (await sql.query(
    `SELECT id FROM elevator_units WHERE id = $1::uuid LIMIT 1`,
    [elevatorUnitId],
  )) as Array<Record<string, unknown>>;
  if (!unitRows[0]) return { ok: false, error: 'unit-not-found' };
  try {
    await sql.query(
      `INSERT INTO work_package_elevators
         (organization_id, work_package_id, elevator_unit_id)
       VALUES (app_require_organization_id(), $1::uuid, $2::uuid)`,
      [workPackageId, elevatorUnitId],
    );
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return { ok: false, error: 'already-linked' };
    }
    throw error;
  }
  return { ok: true, workPackageId, elevatorUnitId };
}

export async function unlinkUnitFromWorkPackage(
  workPackageId: string,
  elevatorUnitId: string,
): Promise<boolean> {
  const rows = (await db().query(
    `DELETE FROM work_package_elevators
     WHERE work_package_id = $1::uuid AND elevator_unit_id = $2::uuid
     RETURNING id`,
    [workPackageId, elevatorUnitId],
  )) as Array<Record<string, unknown>>;
  return rows.length > 0;
}

export type RecordProgressResult =
  | { ok: true; package: WorkPackageRecord }
  | { ok: false; error: 'package-not-found' | 'invalid' };

/**
 * Records work-package progress: updates percent/status and appends an
 * immutable event row in the same statement set. Terminal-state rules
 * (cancelled packages stay put) arrive with the Phase 5 progress model;
 * completion equivalence is enforced now by the contract + CHECK.
 */
export async function recordWorkPackageProgress(
  workPackageId: string,
  input: WorkPackageProgressInput,
): Promise<RecordProgressResult> {
  const errors = validateWorkPackageProgress(input);
  if (errors.length) return { ok: false, error: 'invalid' };
  const actorId = requireOrganizationContext().actorId;
  const sql = db();
  const current = (await sql.query(
    `SELECT percent_complete, status FROM work_packages WHERE id = $1::uuid LIMIT 1`,
    [workPackageId],
  )) as Array<{ percent_complete: number; status: string }>;
  const from = current[0];
  if (!from) return { ok: false, error: 'package-not-found' };

  const toStatus = input.status ?? from.status;
  if (
    Number(from.percent_complete) === input.percentComplete &&
    from.status === toStatus
  ) {
    // Nothing changed: report current state without appending noise.
    const unchanged = await getWorkPackage(workPackageId);
    if (!unchanged) return { ok: false, error: 'package-not-found' };
    return { ok: true, package: unchanged };
  }
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE work_packages
       SET percent_complete = $2, status = $3, updated_at = now()
       WHERE id = $1::uuid
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     ),
     event AS (
       INSERT INTO work_package_events
         (organization_id, work_package_id, event, actor_id, meta)
       SELECT app_require_organization_id(), updated.id,
              CASE WHEN $2 <> $4 THEN 'progress_changed' ELSE 'status_changed' END,
              $5::uuid,
              jsonb_build_object(
                'from_percent', $4, 'to_percent', $2,
                'from_status', $6, 'to_status', $3,
                'note', COALESCE($7, '')
              )
       FROM updated
     )
     SELECT updated.*,
            project.display_id AS project_display_id,
            COALESCE(
              (SELECT array_agg(link.elevator_unit_id)
               FROM work_package_elevators AS link
               WHERE link.work_package_id = updated.id
                 AND link.organization_id = updated.organization_id),
              '{}'
            ) AS elevator_unit_ids
     FROM updated
     JOIN modernization_projects AS project
       ON project.id = updated.project_id
      AND project.organization_id = updated.organization_id`,
    [
      workPackageId,
      input.percentComplete,
      toStatus,
      Number(from.percent_complete),
      actorId,
      from.status,
      input.note?.trim() ?? null,
    ],
  )) as WorkPackageRow[];
  const row = rows[0];
  if (!row) return { ok: false, error: 'package-not-found' };
  return { ok: true, package: mapWorkPackage(row) };
}
