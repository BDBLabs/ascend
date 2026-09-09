/**
 * Applies the Ascend demo-organization seed to the database pointed at by
 * DATABASE_URL_OWNER.
 *
 *   node --env-file=/tmp/ascend-owner.env packages/database/seed-ascend-demo.mjs
 *
 * Re-runnable: every insert in seed-ascend-demo.sql is guarded.
 * Staff login is NOT created here — provision it through POST
 * /api/auth/register with FIELD_PROVISION_SECRET.
 *
 * Demo data on a shared branch only — never point this at a real
 * production tenant database.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { splitStatements } from './sql-split.mjs';

const ORG_ID = 'b7ea0f0e-373e-4a89-8684-aaf1c14d26f3';

const connectionString = process.env.DATABASE_URL_OWNER;
if (!connectionString) {
  process.stderr.write('DATABASE_URL_OWNER is not set.\n');
  process.exit(2);
}

const seedPath = join(dirname(fileURLToPath(import.meta.url)), 'seed-ascend-demo.sql');
const source = await readFile(seedPath, 'utf8');

const lines = source
  .split('\n')
  .filter((line) => !line.trim().startsWith('\\set') && !line.trim().startsWith('\\echo'));
const statements = splitStatements(lines.join('\n'));

const client = new pg.Client({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString)
    ? false
    : { rejectUnauthorized: true },
});

await client.connect();
try {
  for (const [index, statement] of statements.entries()) {
    if (process.env.VERBOSE) process.stdout.write(`  [${index}] ${statement.slice(0, 60)}\n`);
    await client.query(statement);
  }
} catch (error) {
  const position = error.position ? ` (at character ${error.position})` : '';
  process.stderr.write(`\nseed-ascend-demo.sql FAILED: ${error.message}${position}\n`);
  process.exitCode = 1;
  process.exit(1);
} finally {
  await client.end();
}

process.stdout.write(`seed-ascend-demo.sql: demo tenant seeded\n`);
process.stdout.write(`  organization_id: ${ORG_ID}\n`);
process.stdout.write(`  next: provision staff via POST /api/auth/register\n`);
