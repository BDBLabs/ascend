import { describe, expect, it } from 'vitest';
import { assertToolEnvironment, parseEnvironment } from './env-guard.mjs';

describe('parseEnvironment', () => {
  it.each(['development', 'preview', 'production'])('accepts %s', (env) => {
    expect(parseEnvironment(env)).toBe(env);
  });

  it('normalizes case and whitespace', () => {
    expect(parseEnvironment('  Preview ')).toBe('preview');
  });

  it.each([undefined, '', 'prod', 'staging', 'local'])('rejects %s', (raw) => {
    expect(() => parseEnvironment(raw)).toThrow(/ENVIRONMENT must be one of/);
  });
});

describe('assertToolEnvironment', () => {
  it('lets seeds run on development and preview', () => {
    expect(() =>
      assertToolEnvironment({ tool: 'seed', env: 'development', mode: 'refuse-production' }),
    ).not.toThrow();
    expect(() =>
      assertToolEnvironment({ tool: 'seed', env: 'preview', mode: 'refuse-production' }),
    ).not.toThrow();
  });

  it('refuses seeds on production with no override possible', () => {
    expect(() =>
      assertToolEnvironment({
        tool: 'seed',
        env: 'production',
        mode: 'refuse-production',
        allowProductionMutation: '1',
      }),
    ).toThrow(/refuses to run against production/);
  });

  it('refuses verify on production', () => {
    expect(() =>
      assertToolEnvironment({ tool: 'verify', env: 'production', mode: 'refuse-production' }),
    ).toThrow(/refuses to run against production/);
  });

  it('lets migrate run off-production without acknowledgement', () => {
    expect(() =>
      assertToolEnvironment({ tool: 'migrate', env: 'preview', mode: 'confirm-production' }),
    ).not.toThrow();
  });

  it('refuses migrate on production without the explicit acknowledgement', () => {
    expect(() =>
      assertToolEnvironment({ tool: 'migrate', env: 'production', mode: 'confirm-production' }),
    ).toThrow(/ALLOW_PRODUCTION_DB_MUTATION=1/);
  });

  it('allows migrate on production only with the explicit acknowledgement', () => {
    expect(() =>
      assertToolEnvironment({
        tool: 'migrate',
        env: 'production',
        mode: 'confirm-production',
        allowProductionMutation: '1',
      }),
    ).not.toThrow();
  });
});
