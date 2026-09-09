/**
 * Form-input parsing for money and hours. String-based throughout — no
 * floating point touches a value on its way to integer cents/hundredths.
 */

/** "1,250,000.50" / "$95" / 807.5 → integer cents, or null when invalid. */
export function parseDollarsToCents(input: unknown): number | null {
  const text =
    typeof input === 'number'
      ? String(input)
      : typeof input === 'string'
        ? input.trim().replace(/[$,\s]/g, '')
        : null;
  if (!text) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "8.5" / 8.5 → integer hundredths of an hour, or null when invalid. */
export function parseHoursToHundredths(input: unknown): number | null {
  const text =
    typeof input === 'number'
      ? String(input)
      : typeof input === 'string'
        ? input.trim().replace(/[\s]/g, '')
        : null;
  if (!text) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const hundredths =
    Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
  if (!Number.isSafeInteger(hundredths) || hundredths <= 0) return null;
  return hundredths;
}
