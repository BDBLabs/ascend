import { describe, expect, it } from 'vitest';

import {
  laborAmountCents,
  toCostEntryInput,
  validateCostEntryInput,
  validateLaborCostInput,
} from './project-cost-contract';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('validateCostEntryInput', () => {
  it('accepts a minimal actual material entry', () => {
    expect(
      validateCostEntryInput({
        projectId: UUID,
        costKind: 'actual',
        costCategory: 'material',
        amountCents: 125000,
        costDate: '2026-10-05',
      }),
    ).toEqual([]);
  });

  it('rejects bad enums, negative money, and bad dates', () => {
    const errors = validateCostEntryInput({
      projectId: UUID,
      costKind: 'spent' as 'actual',
      costCategory: 'parts' as 'material',
      amountCents: -1,
      costDate: '10/05/2026',
    });
    expect(errors.some((e) => e.includes('costKind'))).toBe(true);
    expect(errors.some((e) => e.includes('costCategory'))).toBe(true);
    expect(errors).toContain(
      'amountCents must be a non-negative integer (cents).',
    );
    expect(errors).toContain('costDate must be YYYY-MM-DD.');
  });

  it('requires labor hours and rate together, on labor entries only', () => {
    expect(
      validateCostEntryInput({
        projectId: UUID,
        costKind: 'actual',
        costCategory: 'labor',
        amountCents: 100,
        costDate: '2026-10-05',
        laborHoursHundredths: 850,
      }),
    ).toContain('labor hours and rate must be provided together.');
    expect(
      validateCostEntryInput({
        projectId: UUID,
        costKind: 'actual',
        costCategory: 'material',
        amountCents: 100,
        costDate: '2026-10-05',
        laborHoursHundredths: 850,
        laborRateCentsPerHour: 9500,
      }),
    ).toContain('labor hours/rate apply to labor entries only.');
  });
});

describe('laborAmountCents', () => {
  it('derives integer cents with half-up rounding', () => {
    // 8.5h × $95.00 = $807.50
    expect(laborAmountCents(850, 9500)).toBe(80750);
    // 1.01h × $0.03 = 3.03c → 3c
    expect(laborAmountCents(101, 3)).toBe(3);
    // 1.05h × $0.10 = 10.5c → 11c (half-up)
    expect(laborAmountCents(105, 10)).toBe(11);
  });
});

describe('validateLaborCostInput + toCostEntryInput', () => {
  it('accepts valid labor and derives the labor entry', () => {
    const input = {
      projectId: UUID,
      costKind: 'actual' as const,
      hoursHundredths: 850,
      rateCentsPerHour: 9500,
      costDate: '2026-10-05',
    };
    expect(validateLaborCostInput(input)).toEqual([]);
    expect(toCostEntryInput(input)).toMatchObject({
      costCategory: 'labor',
      amountCents: 80750,
      laborHoursHundredths: 850,
      laborRateCentsPerHour: 9500,
    });
  });

  it('rejects zero hours', () => {
    expect(
      validateLaborCostInput({
        projectId: UUID,
        costKind: 'actual',
        hoursHundredths: 0,
        rateCentsPerHour: 9500,
        costDate: '2026-10-05',
      }),
    ).toContain('hoursHundredths must be a positive integer.');
  });
});
