import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertNoDemoPrincipalInProduction,
  resolveDevelopmentFieldPrincipal,
} from '@/lib/field-api-auth';

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
  delete process.env.VERCEL_ENV;
  delete process.env.JBOX_ENVIRONMENT;
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

  it('never resolves the demo principal on a production deployment, acknowledgement or not', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const deployment of [{ VERCEL_ENV: 'production' }, { JBOX_ENVIRONMENT: 'production' }]) {
      setEnv({
        NODE_ENV: 'production',
        ...deployment,
        FIELD_DEMO_MODE: '1',
        FIELD_DEMO_ALLOW_IN_PRODUCTION: '1',
        DEVELOPMENT_FIELD_ORGANIZATION_ID: ORG_ID,
      });
      await expect(resolveDevelopmentFieldPrincipal()).resolves.toBeNull();
      delete process.env.VERCEL_ENV;
      delete process.env.JBOX_ENVIRONMENT;
    }
  });

  it('resolves the demo principal on a production-built sandbox only with the explicit acknowledgement', async () => {
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

describe('assertNoDemoPrincipalInProduction (startup invariant)', () => {
  it('refuses to start a production deployment carrying any demo variable', () => {
    expect(() => assertNoDemoPrincipalInProduction({ VERCEL_ENV: 'production', FIELD_DEMO_MODE: '1' } as NodeJS.ProcessEnv))
      .toThrow(/FIELD_DEMO_MODE/);
    expect(() => assertNoDemoPrincipalInProduction({
      JBOX_ENVIRONMENT: 'production',
      DEVELOPMENT_FIELD_ORGANIZATION_ID: ORG_ID,
    } as NodeJS.ProcessEnv)).toThrow(/DEVELOPMENT_FIELD_ORGANIZATION_ID/);
  });

  it('allows a clean production deployment and any non-production one', () => {
    expect(() => assertNoDemoPrincipalInProduction({ VERCEL_ENV: 'production' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertNoDemoPrincipalInProduction({ VERCEL_ENV: 'preview', FIELD_DEMO_MODE: '1' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
