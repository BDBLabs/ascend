/**
 * Contractual-obligation tracing contracts.
 *
 * Obligation → milestone → activity → evidence. Terminal states are
 * final; missed milestones may still recover to met; activities
 * flagged evidence_required cannot complete empty-handed.
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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isNullableDate = (v: unknown): v is string | null | undefined =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && DATE_PATTERN.test(v));

export const OBLIGATION_STATUSES = ['open', 'satisfied', 'waived'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export function isObligationStatus(v: unknown): v is ObligationStatus {
  return (
    typeof v === 'string' &&
    (OBLIGATION_STATUSES as readonly string[]).includes(v)
  );
}

export function canTransitionObligation(
  from: ObligationStatus,
  to: ObligationStatus,
): boolean {
  if (from === to) return true;
  return from === 'open' && (to === 'satisfied' || to === 'waived');
}

export const MILESTONE_STATUSES = [
  'pending',
  'met',
  'missed',
  'waived',
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export function isMilestoneStatus(v: unknown): v is MilestoneStatus {
  return (
    typeof v === 'string' &&
    (MILESTONE_STATUSES as readonly string[]).includes(v)
  );
}

export function canTransitionMilestone(
  from: MilestoneStatus,
  to: MilestoneStatus,
): boolean {
  if (from === to) return true;
  if (from === 'pending') {
    return to === 'met' || to === 'missed' || to === 'waived';
  }
  // Missed milestones may recover; met and waived are final.
  return from === 'missed' && (to === 'met' || to === 'waived');
}

export const ACTIVITY_STATUSES = ['pending', 'done', 'waived'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export function isActivityStatus(v: unknown): v is ActivityStatus {
  return (
    typeof v === 'string' &&
    (ACTIVITY_STATUSES as readonly string[]).includes(v)
  );
}

export function canTransitionActivity(
  from: ActivityStatus,
  to: ActivityStatus,
): boolean {
  if (from === to) return true;
  return from === 'pending' && (to === 'done' || to === 'waived');
}

export const EVIDENCE_KINDS = [
  'note',
  'document',
  'photo',
  'event',
  'other',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export function isEvidenceKind(v: unknown): v is EvidenceKind {
  return (
    typeof v === 'string' &&
    (EVIDENCE_KINDS as readonly string[]).includes(v)
  );
}

export type ObligationInput = {
  projectId: string;
  title: string;
  description?: string;
  sourceRef?: string;
  dueDate?: string | null;
};

export function validateObligationInput(input: ObligationInput): string[] {
  const errors: string[] = [];
  if (!isUuid(input.projectId)) errors.push('projectId must be a UUID.');
  if (!isStr(input.title, 2, 200)) errors.push('title must be 2-200 characters.');
  if (input.description !== undefined && !isStr(input.description, 0, 4000))
    errors.push('description must be at most 4000 characters.');
  if (input.sourceRef !== undefined && !isStr(input.sourceRef, 0, 200))
    errors.push('sourceRef must be at most 200 characters.');
  if (!isNullableDate(input.dueDate ?? null))
    errors.push('dueDate must be YYYY-MM-DD or null.');
  return errors;
}

export type MilestoneInput = {
  obligationId: string;
  title: string;
  description?: string;
  dueDate?: string | null;
};

export function validateMilestoneInput(input: MilestoneInput): string[] {
  const errors: string[] = [];
  if (!isUuid(input.obligationId)) errors.push('obligationId must be a UUID.');
  if (!isStr(input.title, 2, 200)) errors.push('title must be 2-200 characters.');
  if (input.description !== undefined && !isStr(input.description, 0, 4000))
    errors.push('description must be at most 4000 characters.');
  if (!isNullableDate(input.dueDate ?? null))
    errors.push('dueDate must be YYYY-MM-DD or null.');
  return errors;
}

export type ActivityInput = {
  milestoneId: string;
  workPackageId?: string | null;
  title: string;
  description?: string;
  evidenceRequired?: boolean;
};

export function validateActivityInput(input: ActivityInput): string[] {
  const errors: string[] = [];
  if (!isUuid(input.milestoneId)) errors.push('milestoneId must be a UUID.');
  if (!isNullableUuid(input.workPackageId))
    errors.push('workPackageId must be a UUID or null.');
  if (!isStr(input.title, 2, 200)) errors.push('title must be 2-200 characters.');
  if (input.description !== undefined && !isStr(input.description, 0, 4000))
    errors.push('description must be at most 4000 characters.');
  if (
    input.evidenceRequired !== undefined &&
    typeof input.evidenceRequired !== 'boolean'
  )
    errors.push('evidenceRequired must be a boolean.');
  return errors;
}

export type EvidenceInput = {
  kind: EvidenceKind;
  ref?: string;
  note?: string;
};

export function validateEvidenceInput(input: EvidenceInput): string[] {
  const errors: string[] = [];
  if (!isEvidenceKind(input.kind))
    errors.push(`kind must be one of: ${EVIDENCE_KINDS.join(', ')}.`);
  if (input.ref !== undefined && !isStr(input.ref, 0, 1000))
    errors.push('ref must be at most 1000 characters.');
  if (input.note !== undefined && !isStr(input.note, 0, 1000))
    errors.push('note must be at most 1000 characters.');
  if (
    (input.ref ?? '') === '' &&
    (input.note ?? '') === ''
  )
    errors.push('evidence needs a ref, a note, or both.');
  return errors;
}
