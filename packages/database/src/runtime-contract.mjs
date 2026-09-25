/**
 * Runtime contract shared by the database tools (migrate/verify/seed) and both
 * applications. Plain ESM with a .d.mts so the .mjs tools and the TypeScript
 * apps use one implementation.
 *
 * 1. Environment identity (P1.3). Every process declares which environment it
 *    targets (JBOX_ENVIRONMENT, or derived from VERCEL_ENV/NODE_ENV for apps).
 *    Two independent checks then refuse a cross-environment connection:
 *      - before connecting: a Neon endpoint must be registered under the
 *        declared environment in config/database-environments.json;
 *      - after connecting: the database's own stamp (_jbox_environment, written
 *        by the first migration run) must equal the declared environment.
 *    A development process pointed at production therefore fails before it
 *    reads or writes anything.
 *
 * 2. TLS semantics (P4.3). node-postgres treats sslmode=require as verify-full
 *    and warns about it. The contract makes that explicit: sslmode and
 *    channel_binding are removed from the URL and TLS is configured directly --
 *    certificate verification for every non-local host, plaintext only for a
 *    loopback database.
 */

export const ENVIRONMENTS = Object.freeze(['development', 'preview', 'production', 'ci', 'test']);

/** Environments whose database may live on the loopback interface. */
const LOCAL_ENVIRONMENTS = new Set(['development', 'ci', 'test']);

export class EnvironmentGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnvironmentGuardError';
  }
}

export const STAMP_TABLE = '_jbox_environment';

export function isLoopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname) || hostname.startsWith('/');
}

/**
 * Describes a connection string without its credential: kind, host, and the
 * Neon endpoint id when the host is a Neon endpoint.
 */
export function describeDatabaseUrl(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new EnvironmentGuardError('The database connection string is not a valid URL.');
  }
  const hostname = url.hostname;
  const neon = hostname.match(/^(ep-[a-z0-9-]+?)(?:-pooler)?\.[a-z0-9.-]*neon\.tech$/);
  return {
    hostname,
    kind: isLoopbackHost(hostname) ? 'local' : neon ? 'neon' : 'other',
    endpointId: neon ? neon[1] : null,
    pooled: /-pooler\./.test(hostname),
  };
}

export function parseDeclaredEnvironment(value) {
  const declared = (value ?? '').trim();
  if (!declared) {
    throw new EnvironmentGuardError(
      'JBOX_ENVIRONMENT is not set. Declare the environment this command targets '
      + `(${ENVIRONMENTS.join(', ')}); see docs/DATABASE_SETUP.md#environment-identity.`,
    );
  }
  if (!ENVIRONMENTS.includes(declared)) {
    throw new EnvironmentGuardError(`JBOX_ENVIRONMENT=${declared} is not one of ${ENVIRONMENTS.join(', ')}.`);
  }
  return declared;
}

/**
 * The environment a deployed/running application is in. An explicit
 * JBOX_ENVIRONMENT wins but must agree with the platform's own signal: a
 * Vercel production deployment can never declare itself development.
 */
export function resolveRuntimeEnvironment(env) {
  const vercel = env.VERCEL_ENV;
  const platform = vercel === 'production' ? 'production'
    : vercel === 'preview' ? 'preview'
    : vercel === 'development' ? 'development'
    : null;
  const explicit = env.JBOX_ENVIRONMENT?.trim();
  if (explicit) {
    const declared = parseDeclaredEnvironment(explicit);
    if (platform && platform !== declared) {
      throw new EnvironmentGuardError(
        `JBOX_ENVIRONMENT=${declared} contradicts VERCEL_ENV=${vercel}.`,
      );
    }
    return declared;
  }
  if (platform) return platform;
  if (env.NODE_ENV === 'test') return 'test';
  if (env.NODE_ENV === 'production') {
    throw new EnvironmentGuardError(
      'A production build outside Vercel must declare JBOX_ENVIRONMENT.',
    );
  }
  return 'development';
}

function registeredOwner(registry, endpointId) {
  for (const [name, entry] of Object.entries(registry?.environments ?? {})) {
    if ((entry.endpointIds ?? []).includes(endpointId)) return name;
  }
  return null;
}

/**
 * Pre-connect check for operator tools. Throws before any connection when the
 * target does not belong to the declared environment.
 *
 *   options.allowProduction  the tool supports production AND the operator
 *                            passed its explicit production flag.
 */
export function assertToolTarget({ declared, connectionString, registry, tool, allowProduction = false }) {
  const target = describeDatabaseUrl(connectionString);

  if (declared === 'production' && !allowProduction) {
    throw new EnvironmentGuardError(
      tool === 'migrate'
        ? 'production requires the explicit --production flag.'
        : `${tool} never runs against production.`,
    );
  }

  if (target.kind === 'local') {
    if (!LOCAL_ENVIRONMENTS.has(declared)) {
      throw new EnvironmentGuardError(
        `JBOX_ENVIRONMENT=${declared} cannot target a loopback database.`,
      );
    }
    return target;
  }

  if (target.kind !== 'neon') {
    throw new EnvironmentGuardError(`${target.hostname} is not a registered database host.`);
  }

  const owner = registeredOwner(registry, target.endpointId);
  if (!owner) {
    throw new EnvironmentGuardError(
      `Neon endpoint ${target.endpointId} is not registered in `
      + 'config/database-environments.json. Register it under its environment first.',
    );
  }
  if (owner !== declared) {
    throw new EnvironmentGuardError(
      `endpoint ${target.endpointId} belongs to ${owner}, but JBOX_ENVIRONMENT=${declared}. `
      + 'Refusing a cross-environment run.',
    );
  }
  return target;
}

/**
 * Runtime pre-connect check for the apps: refuse a Neon endpoint registered to
 * a different environment. (Unregistered endpoints are allowed at runtime; the
 * post-connect stamp check is the backstop.)
 */
export function assertRuntimeTarget({ declared, connectionString, registry }) {
  const target = describeDatabaseUrl(connectionString);
  if (target.kind === 'local' && !LOCAL_ENVIRONMENTS.has(declared)) {
    throw new EnvironmentGuardError(`A ${declared} deployment cannot use a loopback database.`);
  }
  if (target.kind === 'neon') {
    const owner = registeredOwner(registry, target.endpointId);
    if (owner && owner !== declared) {
      throw new EnvironmentGuardError(
        `Database endpoint ${target.endpointId} belongs to ${owner}; this process is ${declared}.`,
      );
    }
  }
  return target;
}

/**
 * Post-connect check against the database's own stamp.
 *   stamp     value read from _jbox_environment (null when absent)
 *   required  whether an absent stamp is itself a refusal
 */
export function assertStamp({ stamp, declared, required }) {
  if (stamp == null) {
    if (required) {
      throw new EnvironmentGuardError(
        `This database carries no environment stamp; run the migration runner with JBOX_ENVIRONMENT=${declared} first.`,
      );
    }
    return;
  }
  if (stamp !== declared) {
    throw new EnvironmentGuardError(
      `This database is stamped ${stamp}, but the process targets ${declared}. Refusing a cross-environment run.`,
    );
  }
}

/** Reads the stamp through any pg-style client; null when never stamped. */
export async function readStamp(client) {
  const exists = await client.query(`SELECT to_regclass('public.${STAMP_TABLE}') IS NOT NULL AS present`);
  if (!exists.rows[0]?.present) return null;
  const rows = await client.query(`SELECT environment FROM public.${STAMP_TABLE}`);
  return rows.rows[0]?.environment ?? null;
}

/**
 * pg.Pool/Client configuration with explicit TLS: verify-full for every
 * non-loopback host, no TLS on loopback. sslmode/channel_binding are stripped
 * from the URL so they cannot override the explicit setting.
 */
export function pgConnectionConfig(connectionString) {
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');
  url.searchParams.delete('uselibpqcompat');
  return {
    connectionString: url.toString(),
    ssl: isLoopbackHost(url.hostname) ? false : { rejectUnauthorized: true },
  };
}

/**
 * One call for an application pool: resolves the process environment, refuses
 * a Neon endpoint registered to another environment (before connecting), and
 * returns explicit-TLS pool config plus a once-per-process verifier that checks
 * the database stamp on the first connection before any application query.
 */
export function createRuntimeGuard({ connectionString, env, registry }) {
  const environment = resolveRuntimeEnvironment(env);
  assertRuntimeTarget({ declared: environment, connectionString, registry });
  let verified = null;
  return {
    environment,
    config: pgConnectionConfig(connectionString),
    verifyStamp(client) {
      if (!verified) {
        verified = readStamp(client)
          .then((stamp) => assertStamp({ stamp, declared: environment, required: false }))
          .catch((error) => {
            verified = null;
            throw error;
          });
      }
      return verified;
    },
  };
}
