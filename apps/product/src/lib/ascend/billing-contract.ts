/**
 * Ascend Phase 6 progress-billing input contracts.
 *
 * Pure validators + amount math mirroring migration 028. Application
 * workflow: draft -> submitted -> approved -> invoiced, with rejected
 * returning to submitted for rework. Approved snapshots are frozen;
 * only drafts may be voided.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isStr = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && UUID_PATTERN.test(v);

const isNonNegInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

const isPositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

const isRetainagePercent = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type BillingScheduleInput = {
  projectId: string;
  retainagePercent: number;
  notes?: string;
};

export function validateBillingSchedule(
  input: BillingScheduleInput,
): string[] {
  const errors: string[] = [];
  if (!isUuid(input.projectId)) errors.push('projectId must be a UUID.');
  if (!isRetainagePercent(input.retainagePercent))
    errors.push('retainagePercent must be an integer 0-100.');
  if (input.notes !== undefined && !isStr(input.notes, 0, 4000))
    errors.push('notes must be at most 4000 characters.');
  return errors;
}

export type BillingPeriodInput = {
  projectId: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
};

export function validateBillingPeriod(input: BillingPeriodInput): string[] {
  const errors: string[] = [];
  if (!isUuid(input.projectId)) errors.push('projectId must be a UUID.');
  if (!isPositiveInt(input.periodNumber))
    errors.push('periodNumber must be a positive integer.');
  if (typeof input.periodStart !== 'string' || !DATE_PATTERN.test(input.periodStart))
    errors.push('periodStart must be YYYY-MM-DD.');
  if (typeof input.periodEnd !== 'string' || !DATE_PATTERN.test(input.periodEnd))
    errors.push('periodEnd must be YYYY-MM-DD.');
  if (
    DATE_PATTERN.test(input.periodStart ?? '') &&
    DATE_PATTERN.test(input.periodEnd ?? '') &&
    input.periodEnd < input.periodStart
  )
    errors.push('periodEnd must not precede periodStart.');
  return errors;
}

export const APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'invoiced',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function isApplicationStatus(v: unknown): v is ApplicationStatus {
  return (
    typeof v === 'string' &&
    (APPLICATION_STATUSES as readonly string[]).includes(v)
  );
}

const APPLICATION_TRANSITIONS: Record<
  ApplicationStatus,
  ReadonlySet<ApplicationStatus>
> = {
  draft: new Set(['submitted']),
  submitted: new Set(['approved', 'rejected']),
  approved: new Set(['invoiced']),
  rejected: new Set(['submitted']),
  invoiced: new Set(),
};

export function canTransitionApplication(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return APPLICATION_TRANSITIONS[from]?.has(to) ?? false;
}

export type BillingAmountsInput = {
  contractValueCents: number;
  earnedValueCents: number;
  previouslyBilledCents: number;
  retainagePercent: number;
  storedMaterialsCents: number;
};

export type BillingAmounts = {
  retainageCents: number;
  currentDueCents: number;
  remainingContractCents: number;
};

/**
 * Application-for-payment math, integer only. Retainage is held against
 * earned value (stored materials bill free of retainage, industry
 * standard). currentDue may be negative — a credit balance is a fact.
 */
export function computeBillingAmounts(
  input: BillingAmountsInput,
): BillingAmounts {
  const retainageCents = Math.floor(
    (input.earnedValueCents * input.retainagePercent + 50) / 100,
  );
  const currentDueCents =
    input.earnedValueCents -
    input.previouslyBilledCents -
    retainageCents +
    input.storedMaterialsCents;
  return {
    retainageCents,
    currentDueCents,
    remainingContractCents: input.contractValueCents - currentDueCents,
  };
}

export type ApplicationDraftInput = {
  storedMaterialsCents?: number;
  notes?: string;
};

export function validateApplicationDraft(input: ApplicationDraftInput): string[] {
  const errors: string[] = [];
  if (
    input.storedMaterialsCents !== undefined &&
    !isNonNegInt(input.storedMaterialsCents)
  )
    errors.push(
      'storedMaterialsCents must be a non-negative integer (cents).',
    );
  if (input.notes !== undefined && !isStr(input.notes, 0, 4000))
    errors.push('notes must be at most 4000 characters.');
  return errors;
}

export type ApplicationInvoiceLine = {
  description: string;
  amountCents: number;
};

/**
 * Builds the invoice lines the engine consumes from an approved
 * application. The lines itemize to exactly the application's current
 * amount due (earned − previously billed − retainage + stored), so the
 * invoice total agrees with the billing snapshot by construction. The
 * invoice module owns tax, totals, and issuance; this only translates
 * the frozen billing facts into line items.
 */
export function buildApplicationInvoiceLines(input: {
  displayId: string;
  periodNumber: number;
  earnedValueCents: number;
  previouslyBilledCents: number;
  retainageCents: number;
  storedMaterialsCents: number;
}): ApplicationInvoiceLine[] {
  const tag = `application #${input.periodNumber}`;
  const lines: ApplicationInvoiceLine[] = [
    {
      description: `Progress billing ${input.displayId} — work earned (${tag})`,
      amountCents: input.earnedValueCents,
    },
  ];
  if (input.previouslyBilledCents > 0) {
    lines.push({
      description: `Less previously billed (${tag})`,
      amountCents: -input.previouslyBilledCents,
    });
  }
  if (input.retainageCents > 0) {
    lines.push({
      description: `Less retainage held (${tag})`,
      amountCents: -input.retainageCents,
    });
  }
  if (input.storedMaterialsCents > 0) {
    lines.push({
      description: `Stored materials (${tag})`,
      amountCents: input.storedMaterialsCents,
    });
  }
  return lines;
}
