/**
 * Pre-promotion gate (P4.2). READ-ONLY checks that a database -- and,
 * optionally, a deployment's environment -- satisfy the runtime contract
 * before code is promoted onto it:
 *
 *   ASCEND_ENVIRONMENT=preview node --env-file=.env.neon.preview.local \
 *     packages/database/preflight.mjs [--app-env=<file from `vercel env pull`>] [--app=product|control]
 *
 * Database:  no pending migrations; login roles exist with NOSUPERUSER,
 *            NOBYPASSRLS, NOINHERIT, NOCREATEROLE and exactly the expected
 *            memberships; no application role bypasses RLS; FORCE RLS on every
 *            table carrying organization_id; no function executable by PUBLIC;
 *            environment stamp matches.
 * App env:   prohibited variables absent (demo principal, provisioning secret,
 *            owner credential); required secrets present with minimum
 *            strength; the runtime credential is not the owner. Values are
 *            never printed.
 *
 * Exit 0 = PASS, 1 = FAIL (with reasons). Runs against production too: it
 * performs no writes.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planMigrations } from './src/migration-plan.mjs';
import { connectForTool } from './tool-connection.mjs';

const argv = process.argv.slice(2);
const appEnvFile = argv.find((arg) => arg.startsWith('--app-env='))?.slice('--app-env='.length);
const app = argv.find((arg) => arg.startsWith('--app='))?.slice('--app='.length) ?? 'product';

const EXPECTED_MEMBERSHIPS = {
  ascend_runtime: ['contractor_app', 'platform_runtime'],
  ascend_control: ['contractor_app', 'control_app'],
};

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const { client, declared } = await connectForTool({ tool: 'preflight', allowProduction: true, stamp: 'require' });

try {
  // Migrations
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const names = (await readdir(dir)).filter((name) => /^\d+_.+\.sql$/.test(name));
  const files = await Promise.all(names.map(async (name) => ({ name, source: await readFile(join(dir, name), 'utf8') })));
  const ledger = await client.query('SELECT name, checksum FROM _migrations');
  let pending = [];
  try {
    pending = planMigrations({ files, applied: new Map(ledger.rows.map((row) => [row.name, row.checksum])) });
    check('migrations: none pending', pending.length === 0, pending.map((migration) => migration.name).join(', '));
  } catch (error) {
    check('migrations: ledger matches files', false, error.message);
  }

  // Login roles
  const roles = await client.query(`
    SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolinherit, r.rolcreaterole, r.rolcreatedb,
           coalesce(array_agg(g.rolname::text ORDER BY g.rolname) FILTER (WHERE g.rolname IS NOT NULL), '{}'::text[]) AS member_of
      FROM pg_roles r
      LEFT JOIN pg_auth_members m ON m.member = r.oid
      LEFT JOIN pg_roles g ON g.oid = m.roleid
     WHERE r.rolname = ANY($1)
     GROUP BY r.rolname, r.rolsuper, r.rolbypassrls, r.rolinherit, r.rolcreaterole, r.rolcreatedb`,
  [Object.keys(EXPECTED_MEMBERSHIPS)]);
  for (const [login, expected] of Object.entries(EXPECTED_MEMBERSHIPS)) {
    const role = roles.rows.find((row) => row.rolname === login);
    if (!role) { check(`role ${login}: exists`, false); continue; }
    check(`role ${login}: no superuser/bypassrls/inherit/createrole/createdb`,
      !role.rolsuper && !role.rolbypassrls && !role.rolinherit && !role.rolcreaterole && !role.rolcreatedb);
    check(`role ${login}: memberships exactly ${expected.join(', ')}`,
      JSON.stringify(role.member_of) === JSON.stringify(expected), `has ${role.member_of.join(', ')}`);
  }
  const bypass = await client.query(`SELECT rolname FROM pg_roles WHERE rolbypassrls
      AND rolname IN ('contractor_app', 'control_app', 'platform_runtime', 'ascend_runtime', 'ascend_control')`);
  check('no application role bypasses RLS', bypass.rows.length === 0, bypass.rows.map((row) => row.rolname).join(', '));

  // RLS
  const unforced = await client.query(`
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
  check('FORCE RLS on every tenant table', unforced.rows.length === 0, unforced.rows.map((row) => row.relname).join(', '));

  // Function ACL
  const publicExec = await client.query(`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
       AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) acl WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'))`);
  check('no function executable by PUBLIC', publicExec.rows.length === 0, publicExec.rows.map((row) => row.proname).join(', '));
} finally {
  await client.end();
}

// Deployment environment contract
if (appEnvFile) {
  const env = Object.fromEntries((await readFile(appEnvFile, 'utf8')).split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]));
  const set = (name) => typeof env[name] === 'string' && env[name].trim() !== '';
  const deployed = declared === 'production' || declared === 'preview';

  for (const name of ['FIELD_DEMO_MODE', 'DEVELOPMENT_FIELD_ORGANIZATION_ID', 'FIELD_DEMO_ALLOW_IN_PRODUCTION',
    'FIELD_PROVISION_SECRET', 'DATABASE_URL_OWNER']) {
    if (deployed) check(`env: ${name} absent`, !set(name));
  }
  if (declared === 'production') {
    check('env: RESEND_API_KEY absent while the email hold (P0.2) stands', !set('RESEND_API_KEY'),
      'remove this check only when docs/assurance approves enabling delivery');
  }

  const required = app === 'control'
    ? { CONTROL_DATABASE_URL: 1, CONTROL_API_TOKEN: 16, CONTROL_OPERATORS_JSON: 2 }
    : { DATABASE_URL: 1, FIELD_AUTH_SECRET: 32, CUSTOMER_LINK_SECRET: 32, CRON_SECRET: 16, PLATFORM_BASE_DOMAIN: 3, CONTROL_API_TOKEN: 16 };
  if (app === 'product' && deployed) Object.assign(required, { STORAGE_S3_BUCKET: 1, STORAGE_S3_ACCESS_KEY_ID: 1, STORAGE_S3_SECRET_ACCESS_KEY: 1 });
  for (const [name, min] of Object.entries(required)) {
    check(`env: ${name} set (min ${min})`, set(name) && env[name].trim().length >= min);
  }

  const runtimeUrl = app === 'control' ? env.CONTROL_DATABASE_URL : env.DATABASE_URL;
  if (runtimeUrl) {
    try {
      const user = decodeURIComponent(new URL(runtimeUrl).username);
      check('env: runtime credential is not the owner', !/owner/.test(user), `user ${user}`);
    } catch {
      check('env: runtime database URL parses', false);
    }
  }
  if (set('ASCEND_ENVIRONMENT')) {
    check('env: ASCEND_ENVIRONMENT matches the target', env.ASCEND_ENVIRONMENT.trim() === declared);
  }
}

let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${!result.ok && result.detail ? ` -- ${result.detail}` : ''}\n`);
}
process.stdout.write(`\npreflight (${declared}): ${failed ? `FAIL, ${failed} of ${results.length} checks` : `PASS, ${results.length} checks`}\n`);
process.exit(failed ? 1 : 0);
