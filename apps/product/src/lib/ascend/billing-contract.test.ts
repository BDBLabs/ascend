import { describe, expect, it } from 'vitest';

import {
  buildApplicationInvoiceLines,
  canTransitionApplication,
  computeBillingAmounts,
  validateApplicationDraft,
  validateBillingPeriod,
  validateBillingSchedule,
} from './billing-contract';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('validateBillingSchedule', () => {
  it('accepts a valid schedule', () => {
    expect(
      validateBillingSchedule({ projectId: UUID, retainagePercent: 10 }),
    ).toEqual([]);
  });

  it('rejects bad projects and out-of-range retainage', () => {
    expect(
      validateBillingSchedule({ projectId: 'bad', retainagePercent: 101 }),
    ).toEqual([
      'projectId must be a UUID.',
      'retainagePercent must be an integer 0-100.',
    ]);
  });
});

describe('validateBillingPeriod', () => {
  it('accepts a valid period', () => {
    expect(
      validateBillingPeriod({
        projectId: UUID,
        periodNumber: 1,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      }),
    ).toEqual([]);
  });

  it('rejects inverted dates and bad numbers', () => {
    const errors = validateBillingPeriod({
      projectId: UUID,
      periodNumber: 0,
      periodStart: '2026-11-01',
      periodEnd: '2026-10-01',
    });
    expect(errors).toContain('periodNumber must be a positive integer.');
    expect(errors).toContain('periodEnd must not precede periodStart.');
  });
});

describe('canTransitionApplication', () => {
  it('walks draft → submitted → approved → invoiced', () => {
    expect(canTransitionApplication('draft', 'submitted')).toBe(true);
    expect(canTransitionApplication('submitted', 'approved')).toBe(true);
    expect(canTransitionApplication('approved', 'invoiced')).toBe(true);
  });

  it('returns rejected work to submitted, never backward past approval', () => {
    expect(canTransitionApplication('submitted', 'rejected')).toBe(true);
    expect(canTransitionApplication('rejected', 'submitted')).toBe(true);
    expect(canTransitionApplication('approved', 'submitted')).toBe(false);
    expect(canTransitionApplication('invoiced', 'approved')).toBe(false);
    expect(canTransitionApplication('draft', 'approved')).toBe(false);
  });
});

describe('computeBillingAmounts', () => {
  it('holds retainage against earned and bills stored materials free', () => {
    // earned 5,920,000, prev 0, 10% retainage, stored 250,000
    const amounts = computeBillingAmounts({
      contractValueCents: 10000000,
      earnedValueCents: 5920000,
      previouslyBilledCents: 0,
      retainagePercent: 10,
      storedMaterialsCents: 250000,
    });
    expect(amounts.retainageCents).toBe(592000);
    expect(amounts.currentDueCents).toBe(5920000 - 592000 + 250000);
    expect(amounts.remainingContractCents).toBe(
      10000000 - (5920000 - 592000 + 250000),
    );
  });

  it('rounds retainage half-up and allows credit balances', () => {
    // 15% of 10c = 1.5c → 2c
    const amounts = computeBillingAmounts({
      contractValueCents: 100,
      earnedValueCents: 10,
      previouslyBilledCents: 50,
      retainagePercent: 15,
      storedMaterialsCents: 0,
    });
    expect(amounts.retainageCents).toBe(2);
    expect(amounts.currentDueCents).toBe(-42);
  });
});

describe('validateApplicationDraft', () => {
  it('accepts empty and stored-materials drafts', () => {
    expect(validateApplicationDraft({})).toEqual([]);
    expect(validateApplicationDraft({ storedMaterialsCents: 250000 })).toEqual(
      [],
    );
  });

  it('rejects negative stored materials', () => {
    expect(
      validateApplicationDraft({ storedMaterialsCents: -1 }),
    ).toContain(
      'storedMaterialsCents must be a non-negative integer (cents).',
    );
  });
});

describe('buildApplicationInvoiceLines', () => {
  it('itemizes to exactly the amount due', () => {
    const lines = buildApplicationInvoiceLines({
      displayId: 'ASC-0001',
      periodNumber: 2,
      earnedValueCents: 5920000,
      previouslyBilledCents: 2000000,
      retainageCents: 592000,
      storedMaterialsCents: 250000,
    });
    const total = lines.reduce((sum, l) => sum + l.amountCents, 0);
    expect(total).toBe(5920000 - 2000000 - 592000 + 250000);
    expect(lines).toHaveLength(4);
  });

  it('emits a single line when only earned value exists', () => {
    const lines = buildApplicationInvoiceLines({
      displayId: 'ASC-0001',
      periodNumber: 1,
      earnedValueCents: 1000000,
      previouslyBilledCents: 0,
      retainageCents: 0,
      storedMaterialsCents: 0,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].amountCents).toBe(1000000);
  });
});
