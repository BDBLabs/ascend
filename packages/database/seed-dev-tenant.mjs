/**
 * Applies the idempotent dev-tenant seed to the database pointed at by
 * DATABASE_URL_OWNER.
 *
 *   node --env-file=.env.local packages/database/seed-dev-tenant.mjs
 *
 * Re-runnable: every insert in seed-dev-tenant.sql is guarded, and the counters
 * it pre-seeds make later app-created documents collide with nothing.
 *
 * DEV ONLY. This seeds a throwaway-looking tenant with placeholder data. Point
 * it at a development or preview branch, never production.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements } from './sql-split.mjs';
import { connectForTool } from './tool-connection.mjs';

const DEV_ORG_ID = 'de000000-0000-0000-0000-000000000001';

const seedPath = join(dirname(fileURLToPath(import.meta.url)), 'seed-dev-tenant.sql');
const source = await readFile(seedPath, 'utf8');

const lines = source
  .split('\n')
  .filter((line) => !line.trim().startsWith('\\set') && !line.trim().startsWith('\\echo'));
const statements = splitStatements(lines.join('\n'));

// Seed data never goes to production (P1.3).
const { client } = await connectForTool({ tool: 'seed-dev-tenant', stamp: 'require' });
try {
  for (const [index, statement] of statements.entries()) {
    if (process.env.VERBOSE) process.stdout.write(`  [${index}] ${statement.slice(0, 60)}\n`);
    await client.query(statement);
  }
} catch (error) {
  const position = error.position
    ? ` (at character ${error.position})`
    : '';
  process.stderr.write(`\nseed-dev-tenant.sql FAILED: ${error.message}${position}\n`);
  process.exitCode = 1;
  process.exit(1);
} finally {
  await client.end();
}

process.stdout.write(`seed-dev-tenant.sql: dev tenant seeded\n`);
process.stdout.write(`  organization_id: ${DEV_ORG_ID}\n`);
process.stdout.write(`  storefront host: paris.useascend.com\n`);
process.stdout.write(`  next: set DEVELOPMENT_FIELD_ORGANIZATION_ID=${DEV_ORG_ID} in .env.local to drive the Field UI\n`);
