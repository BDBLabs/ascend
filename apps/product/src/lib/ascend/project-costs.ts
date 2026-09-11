import 'server-only';

import type {
  CostCategory,
  CostKind,
  LaborCostInput,
  ProjectCostEntryInput,
} from './project-cost-contract';
import {
  isCostCategory,
  isCostKind,
  toCostEntryInput,
  validateCostEntryInput,
  validateLaborCostInput,
} from './project-cost-contract';
import type { ProjectCostEntryRecord } from './ascend-records';
import { mapProjectCostEntry } from './ascend-records';
import { db } from '@/lib/db';
import { requireOrganizationContext } from '@/lib/organization-context-store';

export type { ProjectCostEntryRecord } from './ascend-records';

export type CostEntryListFilter = {
  projectId?: string;
  costKind?: CostKind;
  costCategory?: CostCategory;
  workPackageId?: string;
  elevatorUnitId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
};

type CostEntryRow = Record<string, unknown>;

const ENTRY_SELECT = `
  SELECT
    entry.*,
    project.display_id AS project_display_id,
    unit.unit_number AS elevator_unit_number,
    package.name AS work_package_name,
    to_json(entry.created_at) AS created_at_token,
    to_json(entry.updated_at) AS updated_at_token
  FROM project_cost_entries AS entry
  JOIN modernization_projects AS project
    ON project.id = entry.project_id
   AND project.organization_id = entry.organization_id
  LEFT JOIN elevator_units AS unit
    ON unit.id = entry.elevator_unit_id
   AND unit.organization_id = entry.organization_id
  LEFT JOIN work_packages AS package
    ON package.id = entry.work_package_id
   AND package.organization_id = entry.organization_id
`;

export async function recordCostEntry(
  input: ProjectCostEntryInput,
): Promise<ProjectCostEntryRecord> {
  const errors = validateCostEntryInput(input);
  if (errors.length) throw new Error(`Invalid cost entry: ${errors.join(' ')}`);
  const actorId = requireOrganizationContext().actorId;
  const rows = (await db().query(
    `WITH inserted AS (
       INSERT INTO project_cost_entries
         (organization_id, project_id, elevator_unit_id, work_package_id,
          cost_kind, cost_category, amount_cents,
          labor_hours_hundredths, labor_rate_cents_per_hour,
          cost_date, source_type, source_ref, actor_id, description)
       VALUES
         (app_require_organization_id(), $1::uuid, $2::uuid, $3::uuid,
          $4, $5, $6, $7, $8, $9::date, $10, $11, $12::uuid, $13)
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     )
     SELECT inserted.*,
            project.display_id AS project_display_id,
            unit.unit_number AS elevator_unit_number,
            package.name AS work_package_name
     FROM inserted
     JOIN modernization_projects AS project
       ON project.id = inserted.project_id
      AND project.organization_id = inserted.organization_id
     LEFT JOIN elevator_units AS unit
       ON unit.id = inserted.elevator_unit_id
      AND unit.organization_id = inserted.organization_id
     LEFT JOIN work_packages AS package
       ON package.id = inserted.work_package_id
      AND package.organization_id = inserted.organization_id`,
    [
      input.projectId,
      input.elevatorUnitId ?? null,
      input.workPackageId ?? null,
      input.costKind,
      input.costCategory,
      input.amountCents,
      input.laborHoursHundredths ?? null,
      input.laborRateCentsPerHour ?? null,
      input.costDate,
      input.sourceType?.trim() ?? '',
      input.sourceRef?.trim() ?? '',
      actorId,
      input.description?.trim() ?? '',
    ],
  )) as CostEntryRow[];
  const row = rows[0];
  if (!row) throw new Error('Cost entry insert returned no row.');
  return mapProjectCostEntry(row);
}

/** Records labor with the amount derived from hours × burdened rate. */
export async function recordLaborCost(
  input: LaborCostInput,
): Promise<ProjectCostEntryRecord> {
  const errors = validateLaborCostInput(input);
  if (errors.length) throw new Error(`Invalid labor cost: ${errors.join(' ')}`);
  return recordCostEntry(toCostEntryInput(input));
}

export async function getCostEntry(id: string): Promise<ProjectCostEntryRecord | null> {
  const rows = (await db().query(`${ENTRY_SELECT} WHERE entry.id = $1 LIMIT 1`, [
    id,
  ])) as CostEntryRow[];
  return rows[0] ? mapProjectCostEntry(rows[0]) : null;
}

export async function listCostEntries(
  filter: CostEntryListFilter = {},
): Promise<ProjectCostEntryRecord[]> {
  const projectId = filter.projectId ?? null;
  const costKind = filter.costKind ?? null;
  const costCategory = filter.costCategory ?? null;
  const workPackageId = filter.workPackageId ?? null;
  const elevatorUnitId = filter.elevatorUnitId ?? null;
  const fromDate = filter.fromDate ?? null;
  const toDate = filter.toDate ?? null;
  if (costKind !== null && !isCostKind(costKind)) {
    throw new Error(`Invalid cost kind filter: ${costKind}.`);
  }
  if (costCategory !== null && !isCostCategory(costCategory)) {
    throw new Error(`Invalid cost category filter: ${costCategory}.`);
  }
  const rawLimit = filter.limit ?? 50;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
    : 50;
  const rows = (await db().query(
    `${ENTRY_SELECT}
     WHERE ($1::uuid IS NULL OR entry.project_id = $1::uuid)
       AND ($2::text IS NULL OR entry.cost_kind = $2::text)
       AND ($3::text IS NULL OR entry.cost_category = $3::text)
       AND ($4::uuid IS NULL OR entry.work_package_id = $4::uuid)
       AND ($5::uuid IS NULL OR entry.elevator_unit_id = $5::uuid)
       AND ($6::date IS NULL OR entry.cost_date >= $6::date)
       AND ($7::date IS NULL OR entry.cost_date <= $7::date)
     ORDER BY entry.cost_date DESC, entry.id
     LIMIT $8`,
    [
      projectId,
      costKind,
      costCategory,
      workPackageId,
      elevatorUnitId,
      fromDate,
      toDate,
      limit,
    ],
  )) as CostEntryRow[];
  return rows.map(mapProjectCostEntry);
}

export type CostSummaryBucket = {
  costKind: CostKind;
  costCategory: CostCategory;
  /** Integer cents, summed server-side. */
  totalCents: number;
  entryCount: number;
};

export type ProjectCostSummary = {
  projectId: string;
  buckets: CostSummaryBucket[];
  /** Integer-cent totals per lens, derived from the buckets. */
  totalsByKind: Record<CostKind, number>;
};

/**
 * Server-side rollup: one GROUP BY over the tenant-scoped entries.
 * Summation happens in PostgreSQL (bigint); the client only reshapes.
 */
export async function summarizeProjectCosts(
  projectId: string,
): Promise<ProjectCostSummary> {
  const rows = (await db().query(
    `SELECT cost_kind, cost_category,
            SUM(amount_cents)::bigint AS total_cents,
            COUNT(*)::int AS entry_count
     FROM project_cost_entries
     WHERE project_id = $1::uuid
     GROUP BY cost_kind, cost_category
     ORDER BY cost_kind, cost_category`,
    [projectId],
  )) as Array<{
    cost_kind: CostKind;
    cost_category: CostCategory;
    total_cents: string | number;
    entry_count: number;
  }>;
  const buckets: CostSummaryBucket[] = rows.map((r) => ({
    costKind: r.cost_kind,
    costCategory: r.cost_category,
    totalCents: Number(r.total_cents),
    entryCount: Number(r.entry_count),
  }));
  const totalsByKind: Record<CostKind, number> = {
    budget: 0,
    actual: 0,
    committed: 0,
    forecast: 0,
  };
  for (const b of buckets) {
    totalsByKind[b.costKind] += b.totalCents;
  }
  return { projectId, buckets, totalsByKind };
}

export type WorkPackageCostSummary = {
  workPackageId: string;
  totals: Record<CostKind, number>;
};

/**
 * Per-package cost rollup for progress reporting: one GROUP BY over the
 * project's package-linked entries. Unlinked (project-wide) entries stay
 * in the project totals only.
 */
export async function summarizeCostsByWorkPackage(
  projectId: string,
): Promise<WorkPackageCostSummary[]> {
  const rows = (await db().query(
    `SELECT work_package_id, cost_kind, SUM(amount_cents)::bigint AS total_cents
     FROM project_cost_entries
     WHERE project_id = $1::uuid AND work_package_id IS NOT NULL
     GROUP BY work_package_id, cost_kind
     ORDER BY work_package_id, cost_kind`,
    [projectId],
  )) as Array<{
    work_package_id: string;
    cost_kind: CostKind;
    total_cents: string | number;
  }>;
  const byPackage = new Map<string, Record<CostKind, number>>();
  for (const r of rows) {
    let totals = byPackage.get(r.work_package_id);
    if (!totals) {
      totals = { budget: 0, actual: 0, committed: 0, forecast: 0 };
      byPackage.set(r.work_package_id, totals);
    }
    totals[r.cost_kind] = Number(r.total_cents);
  }
  return [...byPackage.entries()].map(([workPackageId, totals]) => ({
    workPackageId,
    totals,
  }));
}

/**
 * Billed to date: invoice totals for this project's invoiced
 * applications, counting issued invoices and beyond. Drafts and
 * cancelled invoices are not billings. Lives beside the other
 * project financial rollups so project-progress has a cycle-free
 * dependency direction.
 */
export async function getProjectBilledCents(projectId: string): Promise<number> {
  const rows = (await db().query(
    `SELECT COALESCE(SUM(inv.total_cents), 0)::bigint AS total
     FROM progress_applications AS app
     JOIN invoices AS inv
       ON inv.id = app.invoice_id
      AND inv.organization_id = app.organization_id
     WHERE app.project_id = $1::uuid
       AND app.status = 'invoiced'
       AND inv.status IN ('issued', 'partially_paid', 'paid')`,
    [projectId],
  )) as Array<{ total: string | number }>;
  return Number(rows[0]?.total ?? 0);
}

export type UpdateCostEntryInput = {
  amountCents?: number;
  costDate?: string;
  description?: string;
  sourceType?: string;
  sourceRef?: string;
  workPackageId?: string | null;
  elevatorUnitId?: string | null;
};

export type UpdateCostEntryResult =
  | { ok: true; entry: ProjectCostEntryRecord }
  | { ok: false; error: 'entry-not-found' | 'immutable' | 'invalid' };

/**
 * Revises a planning-figure entry (budget, committed, forecast).
 * Posted actuals are immutable by database trigger and refused here
 * before touching the row: correct actuals with a new entry.
 */
export async function updateCostEntry(
  id: string,
  patch: UpdateCostEntryInput,
): Promise<UpdateCostEntryResult> {
  const sql = db();
  const current = (await sql.query(
    `SELECT project_id, elevator_unit_id, work_package_id, cost_kind,
            cost_category, amount_cents, labor_hours_hundredths,
            labor_rate_cents_per_hour, cost_date, source_type, source_ref,
            description
     FROM project_cost_entries WHERE id = $1::uuid LIMIT 1`,
    [id],
  )) as Array<Record<string, unknown>>;
  const row = current[0];
  if (!row) return { ok: false, error: 'entry-not-found' };
  if (row.cost_kind === 'actual') return { ok: false, error: 'immutable' };

  const merged = {
    projectId: row.project_id as string,
    elevatorUnitId:
      patch.elevatorUnitId ?? (row.elevator_unit_id as string | null),
    workPackageId:
      patch.workPackageId ?? (row.work_package_id as string | null),
    costKind: row.cost_kind as CostKind,
    costCategory: row.cost_category as CostCategory,
    amountCents: patch.amountCents ?? Number(row.amount_cents),
    laborHoursHundredths: row.labor_hours_hundredths as number | null,
    laborRateCentsPerHour: row.labor_rate_cents_per_hour as number | null,
    costDate:
      patch.costDate ??
      (row.cost_date instanceof Date
        ? (row.cost_date as Date).toISOString().slice(0, 10)
        : (row.cost_date as string)),
    sourceType: patch.sourceType ?? (row.source_type as string),
    sourceRef: patch.sourceRef ?? (row.source_ref as string),
    description: patch.description ?? (row.description as string),
  };
  const errors = validateCostEntryInput(merged);
  if (errors.length) return { ok: false, error: 'invalid' };

  await sql.query(
    `UPDATE project_cost_entries
     SET amount_cents = $2, cost_date = $3::date, description = $4,
         source_type = $5, source_ref = $6, work_package_id = $7::uuid,
         elevator_unit_id = $8::uuid, updated_at = now()
     WHERE id = $1::uuid`,
    [
      id,
      merged.amountCents,
      merged.costDate,
      merged.description,
      merged.sourceType,
      merged.sourceRef,
      merged.workPackageId,
      merged.elevatorUnitId,
    ],
  );
  const entry = await getCostEntry(id);
  if (!entry) return { ok: false, error: 'entry-not-found' };
  return { ok: true, entry };
}
