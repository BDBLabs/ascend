/**
 * Environment guards for owner-credential database tools
 * (migrate.mjs, verify.mjs, seed-*.mjs).
 *
 * P1.3: every environment gets its own branch, and the tools must fail
 * BEFORE connecting when the declared environment does not permit the
 * operation. `ENVIRONMENT` is stamped into each generated env file by
 * scripts/write-neon-env.mjs, so the declaration travels with the
 * credentials instead of living only in the operator's head.
 *
 * Modes:
 * - 'refuse-production' — seeds and verify: production is never a valid
 *   target, no override exists.
 * - 'confirm-production' — migrate: production requires the explicit
 *   ALLOW_PRODUCTION_DB_MUTATION=1 acknowledgement on top of
 *   ENVIRONMENT=production.
 *
 * Pure functions throw; guardToolEnvironment() writes to stderr and exits 2,
 * matching the existing scripts' missing-config behavior.
 */

export const ENVIRONMENTS = ['development', 'preview', 'production'];

export function parseEnvironment(raw) {
  const value = (raw ?? '').trim().toLowerCase();
  if (!ENVIRONMENTS.includes(value)) {
    throw new Error(
      `ENVIRONMENT must be one of ${ENVIRONMENTS.join(', ')} (got ${JSON.stringify(raw ?? '')}). `
      + 'Set it in the env file; scripts/write-neon-env.mjs stamps it automatically.',
    );
  }
  return value;
}

export function assertToolEnvironment({ tool, env, mode, allowProductionMutation }) {
  const where = `${tool} refuses to run`;
  if (mode === 'refuse-production' && env === 'production') {
    throw new Error(
      `${where} against production. ${tool} is a development/preview operation; `
      + 'point it at a disposable branch instead.',
    );
  }
  if (mode === 'confirm-production' && env === 'production' && allowProductionMutation !== '1') {
    throw new Error(
      `${where} against production without ALLOW_PRODUCTION_DB_MUTATION=1. `
      + 'Set the acknowledgement explicitly for this invocation only; never persist it in an env file.',
    );
  }
}

export function guardToolEnvironment(tool, mode) {
  let env;
  try {
    env = parseEnvironment(process.env.ENVIRONMENT);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  try {
    assertToolEnvironment({
      tool,
      env,
      mode,
      allowProductionMutation: process.env.ALLOW_PRODUCTION_DB_MUTATION,
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  return env;
}
