/**
 * Runs the SQL check suites against a database.
 *
 *   node --env-file=.env.local packages/database/verify.mjs
 *
 * Executes each suite through the bundled node-pg runner, so no psql binary is
 * required. The suites use \set and \echo which the runner strips.
 *
 * DESTRUCTIVE: the checks provision throwaway organizations, then ROLLBACK.
 * Point this at a development or preview branch, never production.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { connectForTool } from './tool-connection.mjs';

const CHECKS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'checks');

// Fail fast, once, before any suite runs: the suites write (then roll back),
// so they never run against production or an unidentified database.
const { client: probe } = await connectForTool({ tool: 'verify', stamp: 'require' });
await probe.end();

const files = readdirSync(CHECKS_DIR).filter((name) => name.endsWith('.sql')).sort();

let failed = 0;
for (const file of files) {
  const result = spawnSync(
    process.execPath,
    [join(dirname(fileURLToPath(import.meta.url)), 'run-sql-check.mjs'), file],
    { stdio: 'inherit', env: process.env },
  );
  if (result.status !== 0) {
    process.stderr.write(`verify: ${file} FAILED\n`);
    failed += 1;
  }
}

if (failed) {
  process.stderr.write(`\nverify: ${failed} of ${files.length} check suite(s) failed\n`);
  process.exit(1);
}
process.stdout.write(`\nverify: ${files.length} check suite(s) passed\n`);
