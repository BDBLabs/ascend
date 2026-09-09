/**
 * Ascend Phase 2 work-package input contracts.
 *
 * Pure validators mirroring the CHECK constraints in migration 025.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isStr = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && UUID_PATTERN.test(v);

const isNonNegInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

const isPercent = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isNullableDate = (v: unknown): v is string | null =>
  v === null || (typeof v === 'string' && DATE_PATTERN.test(v));

export const WORK_PACKAGE_STATUSES = [
  'not_started',
  'in_progress',
  'complete',
  'on_hold',
  'cancelled',
] as const;

export type WorkPackageStatus = (typeof WORK_PACKAGE_STATUSES)[number];

export function isWorkPackageStatus(v: unknown): v is WorkPackageStatus {
  return (
    typeof v === 'string' &&
    (WORK_PACKAGE_STATUSES as readonly string[]).includes(v)
  );
}

export type WorkPackageInput = {
  projectId: string;
  name: string;
  category?: string;
  description?: string;
  budgetCostCents?: number;
  contractValueCents?: number;
  plannedStart?: string | null;
  plannedFinish?: string | null;
  actualStart?: string | null;
  actualFinish?: string | null;
  responsiblePerson?: string;
  notes?: string;
};

export function validateWorkPackageInput(input: WorkPackageInput): string[] {
  const errors: string[] = [];
  if (!isUuid(input.projectId)) errors.push('projectId must be a UUID.');
  if (!isStr(input.name, 2, 200)) errors.push('name must be 2-200 characters.');
  if (input.category !== undefined && !isStr(input.category, 0, 120))
    errors.push('category must be at most 120 characters.');
  if (input.description !== undefined && !isStr(input.description, 0, 4000))
    errors.push('description must be at most 4000 characters.');
  if (input.budgetCostCents !== undefined && !isNonNegInt(input.budgetCostCents))
    errors.push('budgetCostCents must be a non-negative integer (cents).');
  if (
    input.contractValueCents !== undefined &&
    !isNonNegInt(input.contractValueCents)
  )
    errors.push('contractValueCents must be a non-negative integer (cents).');
  for (const field of [
    'plannedStart',
    'plannedFinish',
    'actualStart',
    'actualFinish',
  ] as const) {
    if (!isNullableDate(input[field] ?? null))
      errors.push(`${field} must be YYYY-MM-DD or null.`);
  }
  if (
    input.plannedStart &&
    input.plannedFinish &&
    input.plannedFinish < input.plannedStart
  )
    errors.push('plannedFinish must not precede plannedStart.');
  if (
    input.responsiblePerson !== undefined &&
    !isStr(input.responsiblePerson, 0, 200)
  )
    errors.push('responsiblePerson must be at most 200 characters.');
  if (input.notes !== undefined && !isStr(input.notes, 0, 4000))
    errors.push('notes must be at most 4000 characters.');
  return errors;
}

export type WorkPackageProgressInput = {
  percentComplete: number;
  /** Optional status transition. Completion equivalence is enforced:
   * 100% implies complete, complete implies 100%. */
  status?: WorkPackageStatus;
  note?: string;
};

export function validateWorkPackageProgress(
  input: WorkPackageProgressInput,
): string[] {
  const errors: string[] = [];
  if (!isPercent(input.percentComplete))
    errors.push('percentComplete must be an integer 0-100.');
  if (input.status !== undefined && !isWorkPackageStatus(input.status))
    errors.push(
      `status must be one of: ${WORK_PACKAGE_STATUSES.join(', ')}.`,
    );
  if (
    input.status !== undefined &&
    ((input.status === 'complete') !== (input.percentComplete === 100))
  )
    errors.push(
      'status complete requires 100% and 100% requires status complete.',
    );
  if (input.note !== undefined && !isStr(input.note, 0, 4000))
    errors.push('note must be at most 4000 characters.');
  return errors;
}
