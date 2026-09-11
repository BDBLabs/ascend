import 'server-only';

import type {
  ApplicationDraftInput,
  ApplicationStatus,
  BillingPeriodInput,
  BillingScheduleInput,
} from './billing-contract';
import {
  canTransitionApplication,
  computeBillingAmounts,
  validateApplicationDraft,
  validateBillingPeriod,
  validateBillingSchedule,
} from './billing-contract';
import type {
  BillingPeriodRecord,
  BillingScheduleRecord,
  ProgressApplicationRecord,
} from './ascend-records';
import {
  mapBillingPeriod,
  mapBillingSchedule,
  mapProgressApplication,
} from './ascend-records';
import { db } from '@/lib/db';
import { requireOrganizationContext } from '@/lib/organization-context-store';
import { getProjectProgress } from './project-progress';

export type { BillingPeriodRecord, BillingScheduleRecord, ProgressApplicationRecord } from './ascend-records';
export { buildApplicationInvoiceLines } from './billing-contract';

type Row = Record<string, unknown>;

/* ── Schedules ─────────────────────────────────────────────────────── */

export async function setBillingSchedule(
  input: BillingScheduleInput,
): Promise<BillingScheduleRecord> {
  const errors = validateBillingSchedule(input);
  if (errors.length) throw new Error(`Invalid billing schedule: ${errors.join(' ')}`);
  const rows = (await db().query(
    `INSERT INTO billing_schedules
       (organization_id, project_id, retainage_percent, notes)
     VALUES (app_require_organization_id(), $1::uuid, $2, $3)
     ON CONFLICT (project_id, organization_id)
     DO UPDATE SET retainage_percent = EXCLUDED.retainage_percent,
                   notes = EXCLUDED.notes,
                   updated_at = now()
     RETURNING *, to_json(created_at) AS created_at_token,
               to_json(updated_at) AS updated_at_token`,
    [input.projectId, input.retainagePercent, input.notes?.trim() ?? ''],
  )) as Row[];
  const row = rows[0];
  if (!row) throw new Error('Billing schedule write returned no row.');
  return mapBillingSchedule(row);
}

export async function getBillingSchedule(
  projectId: string,
): Promise<BillingScheduleRecord | null> {
  const rows = (await db().query(
    `SELECT *, to_json(created_at) AS created_at_token,
            to_json(updated_at) AS updated_at_token
     FROM billing_schedules WHERE project_id = $1::uuid LIMIT 1`,
    [projectId],
  )) as Row[];
  return rows[0] ? mapBillingSchedule(rows[0]) : null;
}

/* ── Periods ───────────────────────────────────────────────────────── */

export async function createBillingPeriod(
  input: BillingPeriodInput,
): Promise<BillingPeriodRecord> {
  const errors = validateBillingPeriod(input);
  if (errors.length) throw new Error(`Invalid billing period: ${errors.join(' ')}`);
  const rows = (await db().query(
    `INSERT INTO billing_periods
       (organization_id, project_id, period_number, period_start, period_end)
     VALUES (app_require_organization_id(), $1::uuid, $2, $3::date, $4::date)
     RETURNING *, to_json(created_at) AS created_at_token,
               to_json(updated_at) AS updated_at_token`,
    [input.projectId, input.periodNumber, input.periodStart, input.periodEnd],
  )) as Row[];
  const row = rows[0];
  if (!row) throw new Error('Billing period insert returned no row.');
  return mapBillingPeriod(row);
}

export async function listBillingPeriods(
  projectId: string,
): Promise<BillingPeriodRecord[]> {
  const rows = (await db().query(
    `SELECT *, to_json(created_at) AS created_at_token,
            to_json(updated_at) AS updated_at_token
     FROM billing_periods
     WHERE project_id = $1::uuid
     ORDER BY period_number ASC`,
    [projectId],
  )) as Row[];
  return rows.map(mapBillingPeriod);
}

/* ── Applications ──────────────────────────────────────────────────── */

const APPLICATION_SELECT = `
  SELECT
    app.*,
    period.period_number,
    project.display_id AS project_display_id,
    to_json(app.created_at) AS created_at_token,
    to_json(app.updated_at) AS updated_at_token
  FROM progress_applications AS app
  JOIN billing_periods AS period
    ON period.id = app.billing_period_id
   AND period.organization_id = app.organization_id
  JOIN modernization_projects AS project
    ON project.id = app.project_id
   AND project.organization_id = app.organization_id
`;

export async function getApplication(
  id: string,
): Promise<ProgressApplicationRecord | null> {
  const rows = (await db().query(`${APPLICATION_SELECT} WHERE app.id = $1 LIMIT 1`, [
    id,
  ])) as Row[];
  return rows[0] ? mapProgressApplication(rows[0]) : null;
}

export async function listApplications(
  projectId: string,
): Promise<ProgressApplicationRecord[]> {
  const rows = (await db().query(
    `${APPLICATION_SELECT}
     WHERE app.project_id = $1::uuid
     ORDER BY period.period_number ASC`,
    [projectId],
  )) as Row[];
  return rows.map(mapProgressApplication);
}

export type DraftApplicationResult =
  | { ok: true; application: ProgressApplicationRecord }
  | { ok: false; error: 'period-not-found' | 'period-not-open' | 'already-applied' | 'invalid' };

/**
 * Freezes a draft application for a period: earned value comes from the
 * live progress read model, previously billed from earlier approved /
 * invoiced applications, retainage from the project's schedule. The
 * snapshot never recomputes afterward — approval freezes facts.
 */
export async function createApplicationDraft(
  billingPeriodId: string,
  input: ApplicationDraftInput = {},
): Promise<DraftApplicationResult> {
  const errors = validateApplicationDraft(input);
  if (errors.length) return { ok: false, error: 'invalid' };
  const actorId = requireOrganizationContext().actorId;
  const sql = db();

  const periodRows = (await sql.query(
    `SELECT id, project_id, period_number, status
     FROM billing_periods WHERE id = $1::uuid LIMIT 1`,
    [billingPeriodId],
  )) as Array<{
    id: string;
    project_id: string;
    period_number: number;
    status: string;
  }>;
  const period = periodRows[0];
  if (!period) return { ok: false, error: 'period-not-found' };
  if (period.status !== 'open') return { ok: false, error: 'period-not-open' };

  const existing = (await sql.query(
    `SELECT id FROM progress_applications WHERE billing_period_id = $1::uuid LIMIT 1`,
    [billingPeriodId],
  )) as Array<Record<string, unknown>>;
  if (existing[0]) return { ok: false, error: 'already-applied' };

  const progress = await getProjectProgress(period.project_id);
  if (!progress) return { ok: false, error: 'period-not-found' };
  const schedule = await getBillingSchedule(period.project_id);
  const retainagePercent = schedule?.retainagePercent ?? 0;

  const billedRows = (await sql.query(
    `SELECT COALESCE(SUM(app.current_due_cents), 0)::bigint AS total
     FROM progress_applications AS app
     JOIN billing_periods AS period
       ON period.id = app.billing_period_id
      AND period.organization_id = app.organization_id
     WHERE app.project_id = $1::uuid
       AND period.period_number < $2
       AND app.status IN ('approved', 'invoiced')`,
    [period.project_id, period.period_number],
  )) as Array<{ total: string | number }>;
  const previouslyBilled = Number(billedRows[0]?.total ?? 0);

  const storedMaterials = input.storedMaterialsCents ?? 0;
  const amounts = computeBillingAmounts({
    contractValueCents: progress.currentContractValueCents,
    earnedValueCents: progress.earnedValueCents,
    previouslyBilledCents: previouslyBilled,
    retainagePercent,
    storedMaterialsCents: storedMaterials,
  });

  const rows = (await sql.query(
    `WITH inserted AS (
       INSERT INTO progress_applications
         (organization_id, billing_period_id, project_id,
          contract_value_cents, earned_value_cents, previously_billed_cents,
          retainage_percent, retainage_cents, stored_materials_cents,
          current_due_cents, notes)
       VALUES
         (app_require_organization_id(), $1::uuid, $2::uuid,
          $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     ),
     event AS (
       INSERT INTO progress_application_events
         (organization_id, progress_application_id, event, actor_id, meta)
       SELECT app_require_organization_id(), inserted.id, 'created',
              $11::uuid,
              jsonb_build_object('stored_materials_cents', $8)
       FROM inserted
     )
     SELECT inserted.*, $12 AS period_number,
            project.display_id AS project_display_id
     FROM inserted
     JOIN modernization_projects AS project
       ON project.id = inserted.project_id
      AND project.organization_id = inserted.organization_id`,
    [
      billingPeriodId,
      period.project_id,
      progress.currentContractValueCents,
      progress.earnedValueCents,
      previouslyBilled,
      retainagePercent,
      amounts.retainageCents,
      storedMaterials,
      amounts.currentDueCents,
      input.notes?.trim() ?? '',
      actorId,
      period.period_number,
    ],
  )) as Row[];
  const row = rows[0];
  if (!row) return { ok: false, error: 'period-not-found' };
  return { ok: true, application: mapProgressApplication(row) };
}

export type TransitionApplicationResult =
  | { ok: true; application: ProgressApplicationRecord }
  | {
      ok: false;
      error:
        | 'application-not-found'
        | 'invalid-transition'
        | 'invoice-not-found'
        | 'not-draft';
    };

async function transitionApplication(
  applicationId: string,
  toStatus: ApplicationStatus,
  event: string,
  extraSet: string | null,
  extraParams: unknown[],
  note?: string,
): Promise<TransitionApplicationResult> {
  const actorId = requireOrganizationContext().actorId;
  const sql = db();
  const current = (await sql.query(
    `SELECT status FROM progress_applications WHERE id = $1::uuid LIMIT 1`,
    [applicationId],
  )) as Array<{ status: ApplicationStatus }>;
  const from = current[0]?.status;
  if (!from) return { ok: false, error: 'application-not-found' };
  if (!canTransitionApplication(from, toStatus)) {
    return { ok: false, error: 'invalid-transition' };
  }
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE progress_applications
       SET status = $2, updated_at = now()${extraSet ?? ''}
       WHERE id = $1::uuid
       RETURNING *, to_json(created_at) AS created_at_token,
                 to_json(updated_at) AS updated_at_token
     ),
     event AS (
       INSERT INTO progress_application_events
         (organization_id, progress_application_id, event, actor_id, meta)
       SELECT app_require_organization_id(), updated.id, $3,
              $${5 + extraParams.length}::uuid,
              jsonb_build_object(
                'from_status', $4, 'to_status', $2,
                'note', COALESCE($${6 + extraParams.length}, '')
              )
       FROM updated
     )
     SELECT updated.*,
            period.period_number,
            project.display_id AS project_display_id
     FROM updated
     JOIN billing_periods AS period
       ON period.id = updated.billing_period_id
      AND period.organization_id = updated.organization_id
     JOIN modernization_projects AS project
       ON project.id = updated.project_id
      AND project.organization_id = updated.organization_id`,
    [
      applicationId,
      toStatus,
      event,
      from,
      ...extraParams,
      actorId,
      note?.trim() ?? null,
    ],
  )) as Row[];
  const row = rows[0];
  if (!row) return { ok: false, error: 'application-not-found' };
  return { ok: true, application: mapProgressApplication(row) };
}

export function submitApplication(
  applicationId: string,
  note?: string,
): Promise<TransitionApplicationResult> {
  return transitionApplication(applicationId, 'submitted', 'submitted', null, [], note);
}

export function approveApplication(
  applicationId: string,
  note?: string,
): Promise<TransitionApplicationResult> {
  return transitionApplication(applicationId, 'approved', 'approved', null, [], note);
}

export function rejectApplication(
  applicationId: string,
  note?: string,
): Promise<TransitionApplicationResult> {
  return transitionApplication(applicationId, 'rejected', 'rejected', null, [], note);
}

/**
 * Records the invoice issued against an approved application and closes
 * the period. The invoice itself is created by the existing engine from
 * buildApplicationInvoiceLines(); this only files the linkage.
 */
export async function markApplicationInvoiced(
  applicationId: string,
  invoiceId: string,
): Promise<TransitionApplicationResult> {
  const sql = db();
  const invoiceRows = (await sql.query(
    `SELECT id FROM invoices WHERE id = $1::uuid LIMIT 1`,
    [invoiceId],
  )) as Array<Record<string, unknown>>;
  if (!invoiceRows[0]) return { ok: false, error: 'invoice-not-found' };
  const linked = await transitionApplication(
    applicationId,
    'invoiced',
    'invoiced',
    `, invoice_id = $5::uuid`,
    [invoiceId],
  );
  if (!linked.ok) return linked;
  await sql.query(
    `UPDATE billing_periods SET status = 'closed', updated_at = now()
     WHERE id = $1::uuid`,
    [linked.application.billingPeriodId],
  );
  return linked;
}

export type VoidDraftResult =
  | { ok: true }
  | { ok: false; error: 'application-not-found' | 'not-draft' };

/**
 * Voids a draft application; its events cascade away with it. Only
 * drafts may be voided — submitted history and beyond is permanent.
 * Single statement, so the status guard cannot race.
 */
export async function voidApplicationDraft(
  applicationId: string,
): Promise<VoidDraftResult> {
  const rows = (await db().query(
    `DELETE FROM progress_applications
     WHERE id = $1::uuid AND status = 'draft'
     RETURNING id`,
    [applicationId],
  )) as Array<Record<string, unknown>>;
  if (rows[0]) return { ok: true };
  const current = (await db().query(
    `SELECT id FROM progress_applications WHERE id = $1::uuid LIMIT 1`,
    [applicationId],
  )) as Array<Record<string, unknown>>;
  return current[0]
    ? { ok: false, error: 'not-draft' }
    : { ok: false, error: 'application-not-found' };
}
