import { describe, expect, it } from 'vitest';

import {
  validateWorkPackageInput,
  validateWorkPackageProgress,
} from './work-package-contract';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('validateWorkPackageInput', () => {
  it('accepts a minimal valid package', () => {
    expect(
      validateWorkPackageInput({ projectId: UUID, name: 'Controller' }),
    ).toEqual([]);
  });

  it('accepts full money and schedule fields', () => {
    expect(
      validateWorkPackageInput({
        projectId: UUID,
        name: 'Controller',
        category: 'Controller',
        budgetCostCents: 4500000,
        contractValueCents: 6800000,
        plannedStart: '2026-10-01',
        plannedFinish: '2026-12-01',
        responsiblePerson: 'Bill Parris',
      }),
    ).toEqual([]);
  });

  it('rejects bad project, short name, negative cents, inverted plan', () => {
    const errors = validateWorkPackageInput({
      projectId: 'bad',
      name: 'X',
      budgetCostCents: -1,
      contractValueCents: 10.5,
      plannedStart: '2026-12-01',
      plannedFinish: '2026-10-01',
    });
    expect(errors).toContain('projectId must be a UUID.');
    expect(errors).toContain('name must be 2-200 characters.');
    expect(errors).toContain(
      'budgetCostCents must be a non-negative integer (cents).',
    );
    expect(errors).toContain(
      'contractValueCents must be a non-negative integer (cents).',
    );
    expect(errors).toContain('plannedFinish must not precede plannedStart.');
  });
});

describe('validateWorkPackageProgress', () => {
  it('accepts a plain percent update', () => {
    expect(validateWorkPackageProgress({ percentComplete: 40 })).toEqual([]);
  });

  it('accepts completion with 100%', () => {
    expect(
      validateWorkPackageProgress({ percentComplete: 100, status: 'complete' }),
    ).toEqual([]);
  });

  it('rejects out-of-range percents and unknown statuses', () => {
    expect(validateWorkPackageProgress({ percentComplete: 101 })).toContain(
      'percentComplete must be an integer 0-100.',
    );
    expect(
      validateWorkPackageProgress({
        percentComplete: 50,
        status: 'done' as 'complete',
      }).some((e) => e.includes('status must be one of')),
    ).toBe(true);
  });

  it('enforces completion equivalence both directions', () => {
    expect(
      validateWorkPackageProgress({ percentComplete: 90, status: 'complete' }),
    ).toContain(
      'status complete requires 100% and 100% requires status complete.',
    );
    expect(
      validateWorkPackageProgress({
        percentComplete: 100,
        status: 'in_progress',
      }),
    ).toContain(
      'status complete requires 100% and 100% requires status complete.',
    );
  });
});
