import { describe, expect, it } from 'vitest';
import { classifyHost, tenantSubdomainFromHost } from '@/lib/host';

describe('tenantSubdomainFromHost', () => {
  it('extracts the tenant subdomain from *.useascend.com hosts', () => {
    expect(tenantSubdomainFromHost('paris.useascend.com')).toBe('paris');
    expect(tenantSubdomainFromHost('PARIS.USEASCEND.COM')).toBe('paris');
  });

  it('strips a port', () => {
    expect(tenantSubdomainFromHost('paris.useascend.com:3001')).toBe('paris');
  });

  it('rejects platform hosts', () => {
    for (const host of ['useascend.com', 'www.useascend.com', 'app.useascend.com', 'field.useascend.com']) {
      expect(tenantSubdomainFromHost(host)).toBeNull();
    }
  });

  it('rejects suffix spoofing and unrelated hosts', () => {
    expect(tenantSubdomainFromHost('paris.useascend.com.evil.com')).toBeNull();
    expect(tenantSubdomainFromHost('useascend.com.evil.com')).toBeNull();
    expect(tenantSubdomainFromHost('example.com')).toBeNull();
    expect(tenantSubdomainFromHost('localhost')).toBeNull();
    expect(tenantSubdomainFromHost(null)).toBeNull();
    expect(tenantSubdomainFromHost('')).toBeNull();
  });
});

describe('classifyHost', () => {
  it('classifies tenant, platform, and unknown hosts', () => {
    expect(classifyHost('paris.useascend.com')).toBe('tenant');
    expect(classifyHost('useascend.com')).toBe('platform');
    expect(classifyHost('field.useascend.com')).toBe('platform');
    expect(classifyHost('some.other.domain')).toBe('unknown');
    expect(classifyHost(null)).toBe('unknown');
  });
});
