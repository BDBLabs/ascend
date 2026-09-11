import { describe, expect, it } from 'vitest';

import {
  canTransitionActivity,
  canTransitionMilestone,
  canTransitionObligation,
  validateActivityInput,
  validateEvidenceInput,
  validateMilestoneInput,
  validateObligationInput,
} from './obligation-contract';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('obligation transitions', () => {
  it('opens to satisfied or waived, then final', () => {
    expect(canTransitionObligation('open', 'satisfied')).toBe(true);
    expect(canTransitionObligation('open', 'waived')).toBe(true);
    expect(canTransitionObligation('satisfied', 'open')).toBe(false);
    expect(canTransitionObligation('waived', 'satisfied')).toBe(false);
  });
});

describe('milestone transitions', () => {
  it('walks pending to met, missed, or waived', () => {
    expect(canTransitionMilestone('pending', 'met')).toBe(true);
    expect(canTransitionMilestone('pending', 'missed')).toBe(true);
    expect(canTransitionMilestone('pending', 'waived')).toBe(true);
  });

  it('lets missed milestones recover, met stays final', () => {
    expect(canTransitionMilestone('missed', 'met')).toBe(true);
    expect(canTransitionMilestone('missed', 'waived')).toBe(true);
    expect(canTransitionMilestone('met', 'missed')).toBe(false);
    expect(canTransitionMilestone('waived', 'pending')).toBe(false);
  });
});

describe('activity transitions', () => {
  it('completes or waives from pending only', () => {
    expect(canTransitionActivity('pending', 'done')).toBe(true);
    expect(canTransitionActivity('pending', 'waived')).toBe(true);
    expect(canTransitionActivity('done', 'pending')).toBe(false);
    expect(canTransitionActivity('waived', 'done')).toBe(false);
  });
});

describe('validators', () => {
  it('accepts minimal valid inputs', () => {
    expect(
      validateObligationInput({ projectId: UUID, title: 'Maintain service' }),
    ).toEqual([]);
    expect(
      validateMilestoneInput({ obligationId: UUID, title: 'Interim sign-off' }),
    ).toEqual([]);
    expect(
      validateActivityInput({ milestoneId: UUID, title: 'Torque test' }),
    ).toEqual([]);
    expect(
      validateEvidenceInput({ kind: 'photo', ref: 'store/1.jpg' }),
    ).toEqual([]);
  });

  it('rejects bad ids, short titles, and empty evidence', () => {
    expect(
      validateObligationInput({ projectId: 'bad', title: 'X' }),
    ).toContain('projectId must be a UUID.');
    expect(
      validateActivityInput({ milestoneId: UUID, title: 'X' }),
    ).toContain('title must be 2-200 characters.');
    expect(validateEvidenceInput({ kind: 'photo' })).toContain(
      'evidence needs a ref, a note, or both.',
    );
    expect(
      validateEvidenceInput({ kind: 'fax' as 'note' }).some((e) =>
        e.includes('kind'),
      ),
    ).toBe(true);
  });
});
