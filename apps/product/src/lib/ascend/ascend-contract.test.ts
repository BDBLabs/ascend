import { describe, expect, it } from 'vitest';

import {
  validateBuildingInput,
  validateElevatorUnitInput,
  validateProjectInput,
} from './ascend-contract';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('validateBuildingInput', () => {
  it('accepts a minimal valid building', () => {
    expect(
      validateBuildingInput({ customerId: UUID, name: 'One Court Square' }),
    ).toEqual([]);
  });

  it('rejects a non-UUID customer and a short name', () => {
    const errors = validateBuildingInput({ customerId: 'nope', name: 'X' });
    expect(errors).toContain('customerId must be a UUID.');
    expect(errors).toContain('name must be 2-200 characters.');
  });

  it('rejects overlong contact fields', () => {
    const errors = validateBuildingInput({
      customerId: UUID,
      name: 'Valid Name',
      contactPhone: 'x'.repeat(41),
      contactEmail: 'x'.repeat(321),
    });
    expect(errors).toContain('contactPhone must be at most 40 characters.');
    expect(errors).toContain('contactEmail must be at most 320 characters.');
  });
});

describe('validateElevatorUnitInput', () => {
  it('accepts a minimal valid unit', () => {
    expect(
      validateElevatorUnitInput({ buildingId: UUID, unitNumber: 'CAR-1' }),
    ).toEqual([]);
  });

  it('rejects unknown elevator types and non-positive ratings', () => {
    const errors = validateElevatorUnitInput({
      buildingId: UUID,
      unitNumber: 'CAR-1',
      elevatorType: 'escalator' as 'traction',
      ratedLoadLbs: 0,
      stops: -2,
    });
    expect(errors.some((e) => e.includes('elevatorType'))).toBe(true);
    expect(errors).toContain('ratedLoadLbs must be a positive integer or null.');
    expect(errors).toContain('stops must be a positive integer or null.');
  });

  it('rejects a missing building and blank unit number', () => {
    const errors = validateElevatorUnitInput({
      buildingId: 'bad',
      unitNumber: '',
    });
    expect(errors).toContain('buildingId must be a UUID.');
    expect(errors).toContain('unitNumber must be 1-60 characters.');
  });
});

describe('validateProjectInput', () => {
  it('accepts a minimal valid project', () => {
    expect(
      validateProjectInput({ displayId: 'ASC-0001', customerId: UUID }),
    ).toEqual([]);
  });

  it('rejects bad display ids, customers, statuses, and money', () => {
    const errors = validateProjectInput({
      displayId: 'lowercase!',
      customerId: 'bad',
      status: 'done' as 'closed',
      contractValueCents: -5,
    });
    expect(errors.some((e) => e.includes('displayId'))).toBe(true);
    expect(errors).toContain('customerId must be a UUID.');
    expect(errors.some((e) => e.includes('status'))).toBe(true);
    expect(errors).toContain(
      'contractValueCents must be a non-negative integer (cents).',
    );
  });

  it('rejects a target date before the start date', () => {
    const errors = validateProjectInput({
      displayId: 'ASC-0001',
      customerId: UUID,
      startDate: '2026-10-01',
      targetCompletionDate: '2026-09-01',
    });
    expect(errors).toContain(
      'targetCompletionDate must not precede startDate.',
    );
  });
});
