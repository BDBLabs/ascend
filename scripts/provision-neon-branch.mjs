import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const PROJECT_PATTERN = /^[a-z0-9-]{3,60}$/;
const BRANCH_PATTERN = /^[a-z0-9-]{1,80}$/;
const ENVIRONMENTS = new Set(['development', 'preview', 'production']);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args, { input, env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', () => reject(new Error('subprocess_start_failed')));
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`subprocess_failed_${code}`));
    });
    child.stdin.end(input);
  });
}

async function connectionString(
  projectId,
  branch,
  pooled,
  roleName = 'jbox_owner',
) {
  const args = [
    '-y',
    'neonctl@latest',
    'connection-string',
    branch,
    '--project-id',
    projectId,
    '--role-name',
    roleName,
    '--database-name',
    'jbox',
    ...(pooled ? ['--pooled'] : []),
  ];
  const { stdout } = await run('npx', args);
  const candidate = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('postgres'));
  if (!candidate) throw new Error('connection_string_unavailable');
  return new URL(candidate);
}

function psqlEnvironment(connection) {
  const database = decodeURIComponent(connection.pathname.slice(1));
  return {
    ...process.env,
    PGHOST: connection.hostname,
    PGPORT: connection.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGSSLMODE: connection.searchParams.get('sslmode') || 'require',
    PGCHANNELBINDING:
      connection.searchParams.get('channel_binding') || 'require',
  };
}

async function psql(connection, sql) {
  return run(
    'psql',
    ['-X', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '--quiet'],
    { input: sql, env: psqlEnvironment(connection) },
  );
}

function withCredentials(connection, username, password) {
  const result = new URL(connection);
  result.username = username;
  result.password = password;
  return result.toString();
}

// Exactly the role memberships the applications assume -- no more, no fewer.
const EXPECTED_MEMBERSHIPS = {
  jbox_runtime: ['contractor_app', 'platform_runtime'],
  jbox_control: ['contractor_app', 'control_app'],
};

async function verifyMemberships(connection) {
  const result = await psql(connection, `
SELECT json_object_agg(login, roles)::text
FROM (
  SELECT member.rolname AS login,
         json_agg(role.rolname ORDER BY role.rolname) AS roles
  FROM pg_auth_members AS m
  JOIN pg_roles AS role ON role.oid = m.roleid
  JOIN pg_roles AS member ON member.oid = m.member
  WHERE member.rolname IN ('jbox_runtime', 'jbox_control')
  GROUP BY member.rolname
) AS memberships;
`);
  const line = result.stdout.split(/\r?\n/).map((value) => value.trim()).find((value) => value.startsWith('{'));
  const actual = JSON.parse(line ?? '{}');
  for (const [login, roles] of Object.entries(EXPECTED_MEMBERSHIPS)) {
    if (JSON.stringify(actual[login] ?? []) !== JSON.stringify(roles)) {
      throw new Error('role_verification_membership_failure');
    }
  }
}

const [projectId, branch, environmentName, rotateOwnerFlag] = process.argv.slice(2);
if (
  !PROJECT_PATTERN.test(projectId ?? '') ||
  !BRANCH_PATTERN.test(branch ?? '') ||
  !ENVIRONMENTS.has(environmentName) ||
  !['rotate-owner', 'keep-owner', 'recover-existing'].includes(rotateOwnerFlag)
) {
  fail(
    'Usage: node scripts/provision-neon-branch.mjs <project-id> <branch> development|preview|production rotate-owner|keep-owner|recover-existing',
  );
}

if (
  environmentName === 'production' &&
  !['keep-owner', 'recover-existing'].includes(rotateOwnerFlag)
) {
  fail('Production must retain the Neon-managed owner credential.');
}
if (
  environmentName !== 'production' &&
  !['rotate-owner', 'recover-existing'].includes(rotateOwnerFlag)
) {
  fail('Non-production branches must rotate the copied owner credential.');
}

try {
  const ownerDirect = await connectionString(projectId, branch, false);
  const ownerPooled = await connectionString(projectId, branch, true);

  if (rotateOwnerFlag === 'recover-existing') {
    // Branches provisioned before the contractor_app fix (development and
    // preview; production was hand-corrected) are repaired here. GRANT of an
    // existing membership is a no-op, so this is safe to repeat.
    await psql(ownerDirect, 'GRANT contractor_app TO jbox_control;');
    await verifyMemberships(ownerDirect);

    const runtimeDirect = await connectionString(
      projectId,
      branch,
      false,
      'jbox_runtime',
    );
    const runtimePooled = await connectionString(
      projectId,
      branch,
      true,
      'jbox_runtime',
    );
    const controlPooled = await connectionString(
      projectId,
      branch,
      true,
      'jbox_control',
    );
    const writer = resolve(process.cwd(), 'scripts/write-neon-env.mjs');
    const result = await run(
      'node',
      [writer, environmentName, '--merge'],
      {
        input: JSON.stringify({
          DATABASE_URL: runtimePooled.toString(),
          DATABASE_URL_UNPOOLED: runtimeDirect.toString(),
          DATABASE_URL_OWNER: ownerDirect.toString(),
          CONTROL_DATABASE_URL: controlPooled.toString(),
        }),
      },
    );
    process.stdout.write(result.stdout);
    process.stdout.write(
      `Recovered existing ${branch} credentials without emitting their values.\n`,
    );
    process.exit(0);
  }

  const runtimePassword = randomBytes(32).toString('hex');
  const controlPassword = randomBytes(32).toString('hex');
  const ownerPassword =
    rotateOwnerFlag === 'rotate-owner'
      ? randomBytes(32).toString('hex')
      : decodeURIComponent(ownerDirect.password);

  const sql = `
DO $provision$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname IN ('jbox_runtime', 'jbox_control')
  ) THEN
    RAISE EXCEPTION 'J-Box login roles already exist on this branch.';
  END IF;
END;
$provision$;

CREATE ROLE jbox_runtime LOGIN PASSWORD '${runtimePassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT contractor_app, platform_runtime TO jbox_runtime;
GRANT USAGE ON SCHEMA public TO jbox_runtime;

CREATE ROLE jbox_control LOGIN PASSWORD '${controlPassword}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
-- contractor_app is required: provisioning switches to it under an org
-- context to write tenant content (apps/control/src/lib/control-db.ts).
GRANT control_app, contractor_app TO jbox_control;
GRANT USAGE ON SCHEMA public TO jbox_control;

${rotateOwnerFlag === 'rotate-owner'
    ? `ALTER ROLE jbox_owner PASSWORD '${ownerPassword}';`
    : ''}
`;
  await psql(ownerDirect, sql);

  ownerDirect.password = ownerPassword;
  ownerPooled.password = ownerPassword;

  const verification = await psql(ownerDirect, `
SELECT json_agg(row_to_json(role_check) ORDER BY role_check.rolname)::text
FROM (
  SELECT
    role.rolname,
    role.rolcanlogin,
    role.rolbypassrls,
    role.rolinherit,
    pg_has_role(role.rolname, 'neon_superuser', 'member') AS neon_superuser_member
  FROM pg_roles AS role
  WHERE role.rolname IN (
    'contractor_app',
    'control_app',
    'platform_runtime',
    'jbox_runtime',
    'jbox_control'
  )
) AS role_check;
`);
  const verificationLine = verification.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('['));
  const roles = JSON.parse(verificationLine ?? 'null');
  if (!Array.isArray(roles) || roles.length !== 5) {
    throw new Error('role_verification_incomplete');
  }
  for (const role of roles) {
    if (role.rolbypassrls || role.neon_superuser_member) {
      throw new Error('role_verification_privilege_failure');
    }
    const isLogin = ['jbox_runtime', 'jbox_control'].includes(role.rolname);
    if (role.rolcanlogin !== isLogin || role.rolinherit) {
      throw new Error('role_verification_attribute_failure');
    }
  }

  await verifyMemberships(ownerDirect);

  const credentials = {
    DATABASE_URL: withCredentials(
      ownerPooled,
      'jbox_runtime',
      runtimePassword,
    ),
    DATABASE_URL_UNPOOLED: withCredentials(
      ownerDirect,
      'jbox_runtime',
      runtimePassword,
    ),
    DATABASE_URL_OWNER: ownerDirect.toString(),
    CONTROL_DATABASE_URL: withCredentials(
      ownerPooled,
      'jbox_control',
      controlPassword,
    ),
  };

  const writer = resolve(process.cwd(), 'scripts/write-neon-env.mjs');
  const result = await run('node', [writer, environmentName], {
    input: JSON.stringify(credentials),
  });
  process.stdout.write(result.stdout);
  process.stdout.write(
    `Provisioned ${branch} with distinct restricted SQL roles; no credential values were emitted.\n`,
  );
} catch {
  fail(`Neon role provisioning failed for ${branch}; no credential values were emitted.`);
}
