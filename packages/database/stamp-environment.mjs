/**
 * Re-stamps a database's environment identity (P1.3).
 *
 *   JBOX_ENVIRONMENT=development node --env-file=.env.local \
 *     packages/database/stamp-environment.mjs --from=production
 *
 * A Neon child branch is a copy of its parent, stamp included: a development
 * branch created from production reads "production" until it is re-stamped.
 * Every tool (and both apps) refuse it until then, which is the point -- the
 * operator must say explicitly that this copy is no longer production.
 *
 * Guards: JBOX_ENVIRONMENT is the new stamp; the target endpoint must already
 * be registered under it (so the production endpoint itself can never be
 * re-stamped as something else); --from must equal the current stamp; and
 * nothing is ever re-stamped TO production.
 */
import { refuse } from './tool-connection.mjs';
import { loadEnvironmentRegistry } from './src/environment-registry.mjs';
import {
  assertToolTarget,
  EnvironmentGuardError,
  parseDeclaredEnvironment,
  pgConnectionConfig,
  readStamp,
  STAMP_TABLE,
} from './src/runtime-contract.mjs';
import pg from 'pg';

const tool = 'stamp';
const from = process.argv.slice(2).find((arg) => arg.startsWith('--from='))?.slice('--from='.length);
if (!from) refuse(tool, 'usage: stamp-environment.mjs --from=<current stamp>', 2);

const connectionString = process.env.DATABASE_URL_OWNER;
if (!connectionString) refuse(tool, 'DATABASE_URL_OWNER is not set.', 2);

let declared;
try {
  declared = parseDeclaredEnvironment(process.env.JBOX_ENVIRONMENT);
  if (declared === 'production') {
    throw new EnvironmentGuardError('nothing is re-stamped to production; production is stamped by its first migration run.');
  }
  assertToolTarget({ declared, connectionString, registry: loadEnvironmentRegistry(), tool });
} catch (error) {
  if (error instanceof EnvironmentGuardError) refuse(tool, error.message);
  throw error;
}

const client = new pg.Client(pgConnectionConfig(connectionString));
await client.connect();
try {
  const current = await readStamp(client);
  if (current !== from) {
    refuse(tool, `current stamp is ${current ?? '(none)'}, not ${from}; nothing changed.`);
  }
  await client.query(`UPDATE public.${STAMP_TABLE} SET environment = $1, stamped_at = now()`, [declared]);
  process.stdout.write(`re-stamped ${from} -> ${declared}\n`);
} finally {
  await client.end();
}
