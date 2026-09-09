import { describe, expect, it } from 'vitest';

import {
  canTransitionPartStatus,
  validatePartInput,
  validatePartQuantity,
} from './project-part-contract';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('canTransitionPartStatus', () => {
  it('walks the chain forward', () => {
    expect(canTransitionPartStatus('specified', 'ordered')).toBe(true);
    expect(canTransitionPartStatus('ordered', 'received')).toBe(true);
    expect(canTransitionPartStatus('received', 'installed')).toBe(true);
  });

  it('allows off-the-shelf forward jumps', () => {
    expect(canTransitionPartStatus('specified', 'received')).toBe(true);
  });

  it('refuses rewinds', () => {
    expect(canTransitionPartStatus('received', 'ordered')).toBe(false);
    expect(canTransitionPartStatus('installed', 'allocated')).toBe(false);
  });

  it('exits to cancelled only from early stages', () => {
    expect(canTransitionPartStatus('ordered', 'cancelled')).toBe(true);
    expect(canTransitionPartStatus('received', 'cancelled')).toBe(false);
  });

  it('exits to returned only from received/allocated/installed', () => {
    expect(canTransitionPartStatus('allocated', 'returned')).toBe(true);
    expect(canTransitionPartStatus('ordered', 'returned')).toBe(false);
  });

  it('treats terminal states as final', () => {
    expect(canTransitionPartStatus('returned', 'installed')).toBe(false);
    expect(canTransitionPartStatus('cancelled', 'specified')).toBe(false);
  });
});

describe('validatePartInput', () => {
  it('accepts a minimal valid part', () => {
    expect(
      validatePartInput({
        projectId: UUID,
        description: 'GAL controller, 12 stops',
        quantityRequiredHundredths: 100,
      }),
    ).toEqual([]);
  });

  it('rejects bad ids, short descriptions, and zero quantity', () => {
    const errors = validatePartInput({
      projectId: 'bad',
      description: 'X',
      quantityRequiredHundredths: 0,
    });
    expect(errors).toContain('projectId must be a UUID.');
    expect(errors).toContain('description must be 2-500 characters.');
    expect(errors).toContain(
      'quantityRequiredHundredths must be a positive integer.',
    );
  });
});

describe('validatePartQuantity', () => {
  it('requires at least one field', () => {
    expect(validatePartQuantity({})).toContain(
      'nothing to update: provide a quantity or actual cost.',
    );
  });

  it('accepts received/install/cost updates', () => {
    expect(
      validatePartQuantity({
        quantityReceivedHundredths: 100,
        quantityInstalledHundredths: 50,
        actualCostCents: 680000,
      }),
    ).toEqual([]);
  });
});
