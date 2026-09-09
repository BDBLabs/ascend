/**
 * Ascend Phase 4 part-lifecycle input contracts.
 *
 * Lifecycle: specified -> ordered -> shipped -> received -> allocated ->
 * installed, with returned and cancelled as exits. Forward jumps are
 * allowed (off-the-shelf buys skip the PO flow); backward moves are not —
 * a regression is a new note or a return, never a silent rewind.
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

export const PART_STATUSES = [
  'specified',
  'ordered',
  'shipped',
  'received',
  'allocated',
  'installed',
  'returned',
  'cancelled',
] as const;

export type PartStatus = (typeof PART_STATUSES)[number];

export function isPartStatus(v: unknown): v is PartStatus {
  return (
    typeof v === 'string' && (PART_STATUSES as readonly string[]).includes(v)
  );
}

const FORWARD_ORDER: readonly PartStatus[] = [
  'specified',
  'ordered',
  'shipped',
  'received',
  'allocated',
  'installed',
];

/** Terminal states never transition. */
const TERMINAL: ReadonlySet<PartStatus> = new Set(['returned', 'cancelled']);

export function canTransitionPartStatus(
  from: PartStatus,
  to: PartStatus,
): boolean {
  if (from === to) return true;
  if (TERMINAL.has(from)) return false;
  if (to === 'cancelled') {
    return from === 'specified' || from === 'ordered' || from === 'shipped';
  }
  if (to === 'returned') {
    return from === 'received' || from === 'allocated' || from === 'installed';
  }
  return (
    FORWARD_ORDER.indexOf(to) > FORWARD_ORDER.indexOf(from)
  );
}

export type ProjectPartInput = {
  projectId: string;
  buildingId?: string | null;
  elevatorUnitId?: string | null;
  workPackageId?: string | null;
  inventoryItemId?: string | null;
  description: string;
  quantityRequiredHundredths: number;
  plannedCostCents?: number;
  actualCostCents?: number;
  supplier?: string;
  sourceRef?: string;
  neededDate?: string | null;
  notes?: string;
};

export function validatePartInput(input: ProjectPartInput): string[] {
  const errors: string[] = [];
  if (!isUuid(input.projectId)) errors.push('projectId must be a UUID.');
  if (!isNullableUuid(input.buildingId))
    errors.push('buildingId must be a UUID or null.');
  if (!isNullableUuid(input.elevatorUnitId))
    errors.push('elevatorUnitId must be a UUID or null.');
  if (!isNullableUuid(input.workPackageId))
    errors.push('workPackageId must be a UUID or null.');
  if (!isNullableUuid(input.inventoryItemId))
    errors.push('inventoryItemId must be a UUID or null.');
  if (!isStr(input.description, 2, 500))
    errors.push('description must be 2-500 characters.');
  if (!isPositiveInt(input.quantityRequiredHundredths))
    errors.push('quantityRequiredHundredths must be a positive integer.');
  if (input.plannedCostCents !== undefined && !isNonNegInt(input.plannedCostCents))
    errors.push('plannedCostCents must be a non-negative integer (cents).');
  if (input.actualCostCents !== undefined && !isNonNegInt(input.actualCostCents))
    errors.push('actualCostCents must be a non-negative integer (cents).');
  if (input.supplier !== undefined && !isStr(input.supplier, 0, 200))
    errors.push('supplier must be at most 200 characters.');
  if (input.sourceRef !== undefined && !isStr(input.sourceRef, 0, 200))
    errors.push('sourceRef must be at most 200 characters.');
  if (
    input.neededDate !== undefined &&
    input.neededDate !== null &&
    (typeof input.neededDate !== 'string' || !DATE_PATTERN.test(input.neededDate))
  )
    errors.push('neededDate must be YYYY-MM-DD or null.');
  if (input.notes !== undefined && !isStr(input.notes, 0, 4000))
    errors.push('notes must be at most 4000 characters.');
  return errors;
}

export type PartQuantityInput = {
  quantityReceivedHundredths?: number;
  quantityInstalledHundredths?: number;
  actualCostCents?: number;
  note?: string;
};

export function validatePartQuantity(input: PartQuantityInput): string[] {
  const errors: string[] = [];
  if (
    input.quantityReceivedHundredths !== undefined &&
    !isNonNegInt(input.quantityReceivedHundredths)
  )
    errors.push(
      'quantityReceivedHundredths must be a non-negative integer or omitted.',
    );
  if (
    input.quantityInstalledHundredths !== undefined &&
    !isNonNegInt(input.quantityInstalledHundredths)
  )
    errors.push(
      'quantityInstalledHundredths must be a non-negative integer or omitted.',
    );
  if (input.actualCostCents !== undefined && !isNonNegInt(input.actualCostCents))
    errors.push('actualCostCents must be a non-negative integer (cents).');
  if (input.note !== undefined && !isStr(input.note, 0, 4000))
    errors.push('note must be at most 4000 characters.');
  if (
    input.quantityReceivedHundredths === undefined &&
    input.quantityInstalledHundredths === undefined &&
    input.actualCostCents === undefined
  )
    errors.push('nothing to update: provide a quantity or actual cost.');
  return errors;
}
