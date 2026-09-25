import { describe, expect, it } from 'vitest';
import {
  assertRuntimeTarget,
  assertStamp,
  assertToolTarget,
  describeDatabaseUrl,
  EnvironmentGuardError,
  parseDeclaredEnvironment,
  pgConnectionConfig,
  resolveRuntimeEnvironment,
} from './runtime-contract.mjs';

const registry = {
  environments: {
    production: { endpointIds: ['ep-prod-123'] },
    preview: { endpointIds: ['ep-prev-456'] },
    development: { endpointIds: ['ep-dev-789'] },
  },
};

const neon = (endpoint, pooled = false) =>
  `postgresql://jbox_owner:pw@${endpoint}${pooled ? '-pooler' : ''}.us-east-1.aws.neon.tech/jbox?sslmode=require`;

describe('describeDatabaseUrl', () => {
  it('extracts the Neon endpoint id from direct and pooled hosts', () => {
    expect(describeDatabaseUrl(neon('ep-dev-789'))).toMatchObject({ kind: 'neon', endpointId: 'ep-dev-789', pooled: false });
    expect(describeDatabaseUrl(neon('ep-dev-789', true))).toMatchObject({ kind: 'neon', endpointId: 'ep-dev-789', pooled: true });
  });

  it('recognises loopback and unknown hosts', () => {
    expect(describeDatabaseUrl('postgresql://u:p@localhost:5432/jbox').kind).toBe('local');
    expect(describeDatabaseUrl('postgresql://u:p@db.example.com/jbox').kind).toBe('other');
  });
});

describe('parseDeclaredEnvironment', () => {
  it('requires a known environment', () => {
    expect(() => parseDeclaredEnvironment(undefined)).toThrow(EnvironmentGuardError);
    expect(() => parseDeclaredEnvironment('staging')).toThrow(EnvironmentGuardError);
    expect(parseDeclaredEnvironment('preview')).toBe('preview');
  });
});

describe('assertToolTarget (pre-connect)', () => {
  it('allows a registered endpoint for its own environment', () => {
    expect(assertToolTarget({ declared: 'development', connectionString: neon('ep-dev-789'), registry, tool: 'verify' }).endpointId)
      .toBe('ep-dev-789');
  });

  it('refuses the production endpoint from a development run', () => {
    expect(() => assertToolTarget({ declared: 'development', connectionString: neon('ep-prod-123'), registry, tool: 'verify' }))
      .toThrow(/belongs to production/);
  });

  it('refuses an unregistered Neon endpoint', () => {
    expect(() => assertToolTarget({ declared: 'development', connectionString: neon('ep-unknown-000'), registry, tool: 'migrate' }))
      .toThrow(/not registered/);
  });

  it('refuses production unless the tool allows it explicitly', () => {
    expect(() => assertToolTarget({ declared: 'production', connectionString: neon('ep-prod-123'), registry, tool: 'verify', allowProduction: false }))
      .toThrow(/never runs against production/);
    expect(() => assertToolTarget({ declared: 'production', connectionString: neon('ep-prod-123'), registry, tool: 'migrate' }))
      .toThrow(/--production/);
    expect(assertToolTarget({ declared: 'production', connectionString: neon('ep-prod-123'), registry, tool: 'migrate', allowProduction: true }).kind)
      .toBe('neon');
  });

  it('only lets local environments use a loopback database', () => {
    expect(assertToolTarget({ declared: 'ci', connectionString: 'postgresql://u:p@localhost/jbox', registry, tool: 'verify' }).kind).toBe('local');
    expect(() => assertToolTarget({ declared: 'preview', connectionString: 'postgresql://u:p@localhost/jbox', registry, tool: 'verify' }))
      .toThrow(EnvironmentGuardError);
  });

  it('refuses arbitrary hosts', () => {
    expect(() => assertToolTarget({ declared: 'development', connectionString: 'postgresql://u:p@db.example.com/jbox', registry, tool: 'verify' }))
      .toThrow(/not a registered database host/);
  });
});

describe('assertStamp (post-connect)', () => {
  it('refuses a mismatched stamp', () => {
    expect(() => assertStamp({ stamp: 'production', declared: 'development', required: false }))
      .toThrow(/stamped production/);
  });

  it('refuses a missing stamp only when required', () => {
    expect(() => assertStamp({ stamp: null, declared: 'preview', required: true })).toThrow(/no environment stamp/);
    expect(() => assertStamp({ stamp: null, declared: 'ci', required: false })).not.toThrow();
  });
});

describe('resolveRuntimeEnvironment', () => {
  it('derives the environment from Vercel', () => {
    expect(resolveRuntimeEnvironment({ VERCEL_ENV: 'production' })).toBe('production');
    expect(resolveRuntimeEnvironment({ VERCEL_ENV: 'preview' })).toBe('preview');
  });

  it('refuses an explicit declaration that contradicts Vercel', () => {
    expect(() => resolveRuntimeEnvironment({ VERCEL_ENV: 'production', JBOX_ENVIRONMENT: 'development' }))
      .toThrow(/contradicts/);
  });

  it('requires a declaration for a production build off Vercel (Fly)', () => {
    expect(() => resolveRuntimeEnvironment({ NODE_ENV: 'production' })).toThrow(EnvironmentGuardError);
    expect(resolveRuntimeEnvironment({ NODE_ENV: 'production', JBOX_ENVIRONMENT: 'production' })).toBe('production');
  });

  it('defaults local processes to development', () => {
    expect(resolveRuntimeEnvironment({ NODE_ENV: 'development' })).toBe('development');
  });
});

describe('assertRuntimeTarget', () => {
  it('refuses a development process pointed at the production endpoint', () => {
    expect(() => assertRuntimeTarget({ declared: 'development', connectionString: neon('ep-prod-123', true), registry }))
      .toThrow(/belongs to production/);
  });

  it('refuses a deployed environment on loopback', () => {
    expect(() => assertRuntimeTarget({ declared: 'production', connectionString: 'postgresql://u:p@127.0.0.1/jbox', registry }))
      .toThrow(EnvironmentGuardError);
  });
});

describe('pgConnectionConfig', () => {
  it('verifies certificates for remote hosts and strips URL TLS overrides', () => {
    const config = pgConnectionConfig(neon('ep-dev-789') + '&channel_binding=require');
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.connectionString).not.toMatch(/sslmode|channel_binding/);
  });

  it('uses plaintext only on loopback', () => {
    expect(pgConnectionConfig('postgresql://u:p@localhost:5432/jbox').ssl).toBe(false);
  });
});
