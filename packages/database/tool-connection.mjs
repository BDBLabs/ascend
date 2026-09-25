/**
 * The only way the operator tools (migrate, verify, seeds, stamp) open a
 * database connection. Enforces the P1.3 environment contract:
 *
 *   1. ASCEND_ENVIRONMENT must be declared.
 *   2. Before connecting, the target must belong to that environment
 *      (loopback for development/ci/test; a Neon endpoint registered under it
 *      in config/database-environments.json otherwise). Production is refused
 *      unless the tool supports it and was given its explicit flag.
 *   3. After connecting and before any statement of the tool's own, the
 *      database's stamp must equal the declared environment.
 *
 * A refusal exits with status 3 and a sentence saying why; no credential is
 * ever printed.
 */
import pg from 'pg';
import { loadEnvironmentRegistry } from './src/environment-registry.mjs';
import {
  assertStamp,
  assertToolTarget,
  EnvironmentGuardError,
  ENVIRONMENTS,
  parseDeclaredEnvironment,
  pgConnectionConfig,
  readStamp,
  STAMP_TABLE,
} from './src/runtime-contract.mjs';

export function refuse(tool, message, code = 3) {
  process.stderr.write(`${tool}: ${message}\n`);
  process.exit(code);
}

/**
 * @param {object} options
 * @param {string} options.tool              name for messages
 * @param {boolean} [options.allowProduction] tool supports production and its flag was given
 * @param {'require'|'create'|'optional'} [options.stamp]
 *        require: refuse an unstamped non-loopback database;
 *        create:  stamp an unstamped database with the declared environment
 *                 (the migration runner, after the pre-connect check passed);
 *        optional: accept an unstamped database (never a mismatched one).
 */
export async function connectForTool({ tool, allowProduction = false, stamp = 'require' }) {
  const connectionString = process.env.DATABASE_URL_OWNER;
  if (!connectionString) {
    refuse(tool, 'DATABASE_URL_OWNER is not set. See docs/DATABASE_SETUP.md.', 2);
  }

  let declared;
  let target;
  try {
    declared = parseDeclaredEnvironment(process.env.ASCEND_ENVIRONMENT);
    target = assertToolTarget({
      declared,
      connectionString,
      registry: loadEnvironmentRegistry(),
      tool,
      allowProduction,
    });
  } catch (error) {
    if (error instanceof EnvironmentGuardError) refuse(tool, error.message);
    throw error;
  }

  const client = new pg.Client(pgConnectionConfig(connectionString));
  await client.connect();

  try {
    const current = await readStamp(client);
    if (current == null && stamp === 'create') {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.${STAMP_TABLE} (
          environment text PRIMARY KEY
            CHECK (environment IN (${ENVIRONMENTS.map((name) => `'${name}'`).join(', ')})),
          singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
          stamped_at timestamptz NOT NULL DEFAULT now()
        )`);
      await client.query(`INSERT INTO public.${STAMP_TABLE} (environment) VALUES ($1)`, [declared]);
      // Non-secret; every login may read it so the apps can check it at startup.
      await client.query(`GRANT SELECT ON public.${STAMP_TABLE} TO PUBLIC`);
      process.stdout.write(`stamped database as ${declared}\n`);
    } else {
      assertStamp({
        stamp: current,
        declared,
        required: stamp === 'require' && target.kind !== 'local',
      });
    }
  } catch (error) {
    await client.end().catch(() => {});
    if (error instanceof EnvironmentGuardError) refuse(tool, error.message);
    throw error;
  }

  process.stdout.write(`target:  ${target.hostname} (${declared})\n`);
  return { client, declared, target };
}
