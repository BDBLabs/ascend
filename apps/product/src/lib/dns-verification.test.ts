import { describe, expect, it } from 'vitest';
import { hasVerificationRecord, verificationRecord } from '@/lib/dns-verification';

describe('hasVerificationRecord', () => {
  const token = 'a'.repeat(32);

  it('accepts the exact record, including one split into chunks', async () => {
    expect(await hasVerificationRecord('example.com', token, async () => [[`ascend-verify=${token}`]])).toBe(true);
    expect(await hasVerificationRecord('example.com', token, async () => [['ascend-verify=', token]])).toBe(true);
  });

  it('queries the _ascend-verify label', async () => {
    const names: string[] = [];
    await hasVerificationRecord('example.com', token, async (name) => { names.push(name); return []; });
    expect(names).toEqual([verificationRecord('example.com', token).name]);
  });

  it('refuses a different token, other records, and DNS errors', async () => {
    expect(await hasVerificationRecord('example.com', token, async () => [[`ascend-verify=${'b'.repeat(32)}`]])).toBe(false);
    expect(await hasVerificationRecord('example.com', token, async () => [['v=spf1 -all']])).toBe(false);
    expect(await hasVerificationRecord('example.com', token, async () => { throw new Error('ENOTFOUND'); })).toBe(false);
  });
});
