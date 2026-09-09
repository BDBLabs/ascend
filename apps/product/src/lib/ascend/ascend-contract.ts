/**
 * Ascend Phase 1 input contracts.
 *
 * Pure validators mirroring the CHECK constraints in migration 024. Every
 * limit here must stay in agreement with the database; the database remains
 * authoritative and these exist to fail fast with readable errors.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DISPLAY_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

const isStr = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && UUID_PATTERN.test(v);

const isNonNegInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

const isNullablePositiveInt = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && v > 0);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isNullableDate = (v: unknown): v is string | null =>
  v === null || (typeof v === 'string' && DATE_PATTERN.test(v));

export type BuildingInput = {
  customerId: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  primaryContact?: string;
  contactPhone?: string;
  contactEmail?: string;
  notes?: string;
};

export function validateBuildingInput(input: BuildingInput): string[] {
  const errors: string[] = [];
  if (!isUuid(input.customerId)) errors.push('customerId must be a UUID.');
  if (!isStr(input.name, 2, 200)) errors.push('name must be 2-200 characters.');
  if (input.address !== undefined && !isStr(input.address, 0, 200))
    errors.push('address must be at most 200 characters.');
  if (input.city !== undefined && !isStr(input.city, 0, 100))
    errors.push('city must be at most 100 characters.');
  if (input.state !== undefined && !isStr(input.state, 0, 100))
    errors.push('state must be at most 100 characters.');
  if (input.postalCode !== undefined && !isStr(input.postalCode, 0, 20))
    errors.push('postalCode must be at most 20 characters.');
  if (input.primaryContact !== undefined && !isStr(input.primaryContact, 0, 200))
    errors.push('primaryContact must be at most 200 characters.');
  if (input.contactPhone !== undefined && !isStr(input.contactPhone, 0, 40))
    errors.push('contactPhone must be at most 40 characters.');
  if (input.contactEmail !== undefined && !isStr(input.contactEmail, 0, 320))
    errors.push('contactEmail must be at most 320 characters.');
  if (input.notes !== undefined && !isStr(input.notes, 0, 4000))
    errors.push('notes must be at most 4000 characters.');
  return errors;
}

export const ELEVATOR_TYPES = [
  'traction',
  'hydraulic',
  'machine_room_less',
  'other',
] as const;

export type ElevatorType = (typeof ELEVATOR_TYPES)[number];

export type ElevatorUnitInput = {
  buildingId: string;
  unitNumber: string;
  elevatorNumber?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  elevatorType?: ElevatorType | '';
  ratedLoadLbs?: number | null;
  ratedSpeedFpm?: number | null;
  stops?: number | null;
  floorsServed?: string;
  controllerManufacturer?: string;
  controllerModel?: string;
  driveManufacturer?: string;
  driveModel?: string;
  doorOperatorManufacturer?: string;
  doorOperatorModel?: string;
  existingCondition?: string;
  notes?: string;
};

export function validateElevatorUnitInput(input: ElevatorUnitInput): string[] {
  const errors: string[] = [];
  if (!isUuid(input.buildingId)) errors.push('buildingId must be a UUID.');
  if (!isStr(input.unitNumber, 1, 60))
    errors.push('unitNumber must be 1-60 characters.');
  if (input.elevatorNumber !== undefined && !isStr(input.elevatorNumber, 0, 60))
    errors.push('elevatorNumber must be at most 60 characters.');
  for (const field of [
    'manufacturer',
    'model',
    'serialNumber',
    'controllerManufacturer',
    'controllerModel',
    'driveManufacturer',
    'driveModel',
    'doorOperatorManufacturer',
    'doorOperatorModel',
  ] as const) {
    const value = input[field];
    if (value !== undefined && !isStr(value, 0, 120))
      errors.push(`${field} must be at most 120 characters.`);
  }
  if (
    input.elevatorType !== undefined &&
    input.elevatorType !== '' &&
    !(ELEVATOR_TYPES as readonly string[]).includes(input.elevatorType)
  )
    errors.push(
      `elevatorType must be one of: ${ELEVATOR_TYPES.join(', ')}.`,
    );
  if (!isNullablePositiveInt(input.ratedLoadLbs ?? null))
    errors.push('ratedLoadLbs must be a positive integer or null.');
  if (!isNullablePositiveInt(input.ratedSpeedFpm ?? null))
    errors.push('ratedSpeedFpm must be a positive integer or null.');
  if (!isNullablePositiveInt(input.stops ?? null))
    errors.push('stops must be a positive integer or null.');
  if (input.floorsServed !== undefined && !isStr(input.floorsServed, 0, 200))
    errors.push('floorsServed must be at most 200 characters.');
  if (
    input.existingCondition !== undefined &&
    !isStr(input.existingCondition, 0, 4000)
  )
    errors.push('existingCondition must be at most 4000 characters.');
  if (input.notes !== undefined && !isStr(input.notes, 0, 4000))
    errors.push('notes must be at most 4000 characters.');
  return errors;
}

export const PROJECT_STATUSES = [
  'prospect',
  'bidding',
  'awarded',
  'in_progress',
  'substantially_complete',
  'closed',
  'cancelled',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export function isProjectStatus(v: unknown): v is ProjectStatus {
  return (
    typeof v === 'string' &&
    (PROJECT_STATUSES as readonly string[]).includes(v)
  );
}

export type ModernizationProjectInput = {
  displayId: string;
  customerId: string;
  buildingId?: string | null;
  status?: ProjectStatus;
  contractValueCents?: number;
  projectManager?: string;
  startDate?: string | null;
  targetCompletionDate?: string | null;
  actualCompletionDate?: string | null;
  notes?: string;
};

export function validateProjectInput(
  input: ModernizationProjectInput,
): string[] {
  const errors: string[] = [];
  if (
    typeof input.displayId !== 'string' ||
    !DISPLAY_ID_PATTERN.test(input.displayId)
  )
    errors.push(
      'displayId must match the document pattern (3-32 uppercase alphanumerics/dashes).',
    );
  if (!isUuid(input.customerId)) errors.push('customerId must be a UUID.');
  if (
    input.buildingId !== undefined &&
    input.buildingId !== null &&
    !isUuid(input.buildingId)
  )
    errors.push('buildingId must be a UUID or null.');
  if (input.status !== undefined && !isProjectStatus(input.status))
    errors.push(`status must be one of: ${PROJECT_STATUSES.join(', ')}.`);
  if (input.contractValueCents !== undefined && !isNonNegInt(input.contractValueCents))
    errors.push('contractValueCents must be a non-negative integer (cents).');
  if (input.projectManager !== undefined && !isStr(input.projectManager, 0, 200))
    errors.push('projectManager must be at most 200 characters.');
  if (!isNullableDate(input.startDate ?? null))
    errors.push('startDate must be YYYY-MM-DD or null.');
  if (!isNullableDate(input.targetCompletionDate ?? null))
    errors.push('targetCompletionDate must be YYYY-MM-DD or null.');
  if (!isNullableDate(input.actualCompletionDate ?? null))
    errors.push('actualCompletionDate must be YYYY-MM-DD or null.');
  if (
    input.startDate &&
    input.targetCompletionDate &&
    input.targetCompletionDate < input.startDate
  )
    errors.push('targetCompletionDate must not precede startDate.');
  if (input.notes !== undefined && !isStr(input.notes, 0, 4000))
    errors.push('notes must be at most 4000 characters.');
  return errors;
}
