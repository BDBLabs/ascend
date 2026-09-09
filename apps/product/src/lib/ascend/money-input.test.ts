import { describe, expect, it } from 'vitest';

import { parseDollarsToCents, parseHoursToHundredths } from './money-input';

describe('parseDollarsToCents', () => {
  it('parses exact decimal strings without floats', () => {
    expect(parseDollarsToCents('1,250,000.50')).toBe(125000050);
    expect(parseDollarsToCents('$95')).toBe(9500);
    expect(parseDollarsToCents('807.5')).toBe(80750);
    expect(parseDollarsToCents('0')).toBe(0);
    expect(parseDollarsToCents(10.5)).toBe(1050);
  });

  it('rejects negatives, thirds of a cent, and garbage', () => {
    expect(parseDollarsToCents('-5')).toBeNull();
    expect(parseDollarsToCents('10.001')).toBeNull();
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents(null)).toBeNull();
  });
});

describe('parseHoursToHundredths', () => {
  it('parses hour strings to integer hundredths', () => {
    expect(parseHoursToHundredths('8.5')).toBe(850);
    expect(parseHoursToHundredths('40')).toBe(4000);
    expect(parseHoursToHundredths(1.25)).toBe(125);
  });

  it('rejects zero, negatives, and sub-minute precision', () => {
    expect(parseHoursToHundredths('0')).toBeNull();
    expect(parseHoursToHundredths('-2')).toBeNull();
    expect(parseHoursToHundredths('1.001')).toBeNull();
    expect(parseHoursToHundredths('')).toBeNull();
  });
});
