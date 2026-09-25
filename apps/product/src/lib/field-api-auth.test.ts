import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDevelopmentFieldPrincipal } from '@/lib/field-api-auth';

const ORG_ID = 'org_demo_123';

function setEnv(env: NodeJS.ProcessEnv) {
  delete process.env.FIELD_DEMO_MODE;
  delete process.env.FIELD_DEMO_ALLOW_IN_PRODUCTION;
  delete process.env.DEVELOPMENT_FIELD_ORGANIZATION_ID;
  Object.assign(process.env, env);
}

afterEach(() => {
  delete process.env.FIELD_DEMO_MODE;
  delete process.env.FIELD_DEMO_ALLOW_IN_PRODUCTION;
  delete process.env.DEVELOPMENT_FIELD_ORGANIZATION_ID;
  delete process.env.NODE_ENV;
  vi.restoreAllMocks();
});

describe('resolveDevelopmentFieldPrincipal', () => {
  it('returns null when demo mode is unset, even with an org id (non-production)', () => {
    setEnv({ NODE_ENV: 'development', DEVELOPMENT_FIELD_ORGANIZATION_ID: ORG_ID });
    return expect(resolveDevelopmentFieldPrincipal()).resolves.toBeNull();
  });

  it('returns null when demo mode is set but no org id is configured', async () => {
    setEnv({ NODE_ENV: 'development', FIELD_DEMO_MODE: '1' });
    await expect(resolveDevelopmentFieldPrincipal()).resolves.toBeNull();
  });

  it('resolves the demo owner principal in non-production with both keys', async () => {
    setEnv({
      NODE_ENV: 'development',
      FIELD_DEMO_MODE: '1',
      DEVELOPMENT_FIELD_ORGANIZATION_ID: ORG_ID,
    });
    const principal = await resolveDevelopmentFieldPrincipal();
    expect(principal).not.toBeNull();
    expect(principal?.kind).toBe('development');
    expect(principal?.organizationId).toBe(ORG_ID);
    expect(principal?.role).toBe('owner');
  });

  it('FAIL-CLOSED: returns null in production with demo mode but no production acknowledgement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setEnv({
      NODE_ENV: 'production',
      FIELD_DEMO_MODE: '1',
      DEVELOPMENT_FIELD_ORGANIZATION_ID: ORG_ID,
    });
    await expect(resolveDevelopmentFieldPrincipal()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('resolves the demo principal in production only with the explicit acknowledgement', async () => {
    setEnv({
      NODE_ENV: 'production',
      FIELD_DEMO_MODE: '1',
      FIELD_DEMO_ALLOW_IN_PRODUCTION: '1',
      DEVELOPMENT_FIELD_ORGANIZATION_ID: ORG_ID,
    });
    const principal = await resolveDevelopmentFieldPrincipal();
    expect(principal?.kind).toBe('development');
    expect(principal?.organizationId).toBe(ORG_ID);
  });

  it('returns null in production when demo mode is unset', async () => {
    setEnv({ NODE_ENV: 'production', DEVELOPMENT_FIELD_ORGANIZATION_ID: ORG_ID });
    await expect(resolveDevelopmentFieldPrincipal()).resolves.toBeNull();
  });
});
