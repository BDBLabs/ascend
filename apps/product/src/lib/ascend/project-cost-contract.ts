/**
 * Ascend Phase 3 cost-entry input contracts.
 *
 * Pure validators mirroring the CHECK constraints in migration 026. Money
 * stays integer cents; labor hours stay integer hundredths.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isStr = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && UUID_PATTERN.test(v);

const isNullableUuid = (v: unknown): v is string | null | undefined =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && UUID_PATTERN.test(v));

const isNonNegInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

const isPositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const COST_KINDS = ['budget', 'actual', 'committed', 'forecast'] as const;

export type CostKind = (typeof COST_KINDS)[number];

export function isCostKind(v: unknown): v is CostKind {
  return (
    typeof v === 'string' && (COST_KINDS as readonly string[]).includes(v)
  );
}

export const COST_CATEGORIES = [
  'material',
  'labor',
  'subcontract',
  'freight',
  'engineering',
  'permits',
  'testing',
  'other',
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

export function isCostCategory(v: unknown): v is CostCategory {
  return (
    typeof v === 'string' &&
    (COST_CATEGORIES as readonly string[]).includes(v)
  );
}

export type ProjectCostEntryInput = {
  projectId: string;
  elevatorUnitId?: string | null;
  workPackageId?: string | null;
  costKind: CostKind;
  costCategory: CostCategory;
  amountCents: number;
  laborHoursHundredths?: number | null;
  laborRateCentsPerHour?: number | null;
  costDate: string;
  sourceType?: string;
  sourceRef?: string;
  description?: string;
};

export function validateCostEntryInput(input: ProjectCostEntryInput): string[] {
  const errors: string[] = [];
  if (!isUuid(input.projectId)) errors.push('projectId must be a UUID.');
  if (!isNullableUuid(input.elevatorUnitId))
    errors.push('elevatorUnitId must be a UUID or null.');
  if (!isNullableUuid(input.workPackageId))
    errors.push('workPackageId must be a UUID or null.');
  if (!isCostKind(input.costKind))
    errors.push(`costKind must be one of: ${COST_KINDS.join(', ')}.`);
  if (!isCostCategory(input.costCategory))
    errors.push(`costCategory must be one of: ${COST_CATEGORIES.join(', ')}.`);
  if (!isNonNegInt(input.amountCents))
    errors.push('amountCents must be a non-negative integer (cents).');
  const hours = input.laborHoursHundredths ?? null;
  const rate = input.laborRateCentsPerHour ?? null;
  if (hours !== null && !isPositiveInt(hours))
    errors.push('laborHoursHundredths must be a positive integer or null.');
  if (rate !== null && !isNonNegInt(rate))
    errors.push('laborRateCentsPerHour must be a non-negative integer or null.');
  if ((hours === null) !== (rate === null))
    errors.push('labor hours and rate must be provided together.');
  if (
    input.costCategory !== 'labor' &&
    (hours !== null || rate !== null)
  )
    errors.push('labor hours/rate apply to labor entries only.');
  if (typeof input.costDate !== 'string' || !DATE_PATTERN.test(input.costDate))
    errors.push('costDate must be YYYY-MM-DD.');
  if (input.sourceType !== undefined && !isStr(input.sourceType, 0, 60))
    errors.push('sourceType must be at most 60 characters.');
  if (input.sourceRef !== undefined && !isStr(input.sourceRef, 0, 200))
    errors.push('sourceRef must be at most 200 characters.');
  if (input.description !== undefined && !isStr(input.description, 0, 1000))
    errors.push('description must be at most 1000 characters.');
  return errors;
}

export type LaborCostInput = {
  projectId: string;
  elevatorUnitId?: string | null;
  workPackageId?: string | null;
  costKind: CostKind;
  /** Integer hundredths of an hour: 8.5h = 850. */
  hoursHundredths: number;
  /** Burdened rate, integer cents per hour. */
  rateCentsPerHour: number;
  costDate: string;
  sourceType?: string;
  sourceRef?: string;
  description?: string;
};

/**
 * Derives the authoritative amount from hours × burdened rate with
 * half-up rounding on the final division — the only division in the
 * money path, kept in integer arithmetic.
 */
export function laborAmountCents(
  hoursHundredths: number,
  rateCentsPerHour: number,
): number {
  return Math.floor((hoursHundredths * rateCentsPerHour + 50) / 100);
}

export function validateLaborCostInput(input: LaborCostInput): string[] {
  const errors: string[] = [];
  if (!isUuid(input.projectId)) errors.push('projectId must be a UUID.');
  if (!isNullableUuid(input.elevatorUnitId))
    errors.push('elevatorUnitId must be a UUID or null.');
  if (!isNullableUuid(input.workPackageId))
    errors.push('workPackageId must be a UUID or null.');
  if (!isCostKind(input.costKind))
    errors.push(`costKind must be one of: ${COST_KINDS.join(', ')}.`);
  if (!isPositiveInt(input.hoursHundredths))
    errors.push('hoursHundredths must be a positive integer.');
  if (!isNonNegInt(input.rateCentsPerHour))
    errors.push('rateCentsPerHour must be a non-negative integer (cents).');
  if (typeof input.costDate !== 'string' || !DATE_PATTERN.test(input.costDate))
    errors.push('costDate must be YYYY-MM-DD.');
  if (input.sourceType !== undefined && !isStr(input.sourceType, 0, 60))
    errors.push('sourceType must be at most 60 characters.');
  if (input.sourceRef !== undefined && !isStr(input.sourceRef, 0, 200))
    errors.push('sourceRef must be at most 200 characters.');
  if (input.description !== undefined && !isStr(input.description, 0, 1000))
    errors.push('description must be at most 1000 characters.');
  return errors;
}

export function toCostEntryInput(input: LaborCostInput): ProjectCostEntryInput {
  return {
    projectId: input.projectId,
    elevatorUnitId: input.elevatorUnitId ?? null,
    workPackageId: input.workPackageId ?? null,
    costKind: input.costKind,
    costCategory: 'labor',
    amountCents: laborAmountCents(input.hoursHundredths, input.rateCentsPerHour),
    laborHoursHundredths: input.hoursHundredths,
    laborRateCentsPerHour: input.rateCentsPerHour,
    costDate: input.costDate,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    description: input.description,
  };
}
