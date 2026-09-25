/**
 * Forward-only migrations plus live integrity, RLS, and provisioning checks.
 *
 * Migrations are checksum-guarded: editing an applied migration fails
 * `npm run db:migrate` rather than silently diverging from the deployed
 * schema. Migrations 001 (foundation: tenancy, roles, isolation) and 002
 * (customers, estimates) are written and applied on all three Neon branches;
 * the decisions that shaped 001 are recorded in
 * docs/architecture/foundation-decisions.md. See docs/DATABASE_SETUP.md for
 * the owner/runtime role model that migrations run under.
 */

/**
 * The filename of the most recently added migration.
 *
 * Import this constant into health-check routes so both apps always agree on
 * the expected schema version without keeping two hand-rolled strings in sync.
 * Update it whenever a new migration file is added to migrations/.
 */
export const LATEST_MIGRATION = '034_function_execute_acl.sql';

// Runtime contract (environment identity + explicit TLS), shared with the
// operator tools. The registry is imported statically so it is bundled with
// each app rather than read from disk at runtime.
import environmentRegistry from '../../../config/database-environments.json';
import type { EnvironmentRegistry } from './runtime-contract.mjs';

export const ENVIRONMENT_REGISTRY: EnvironmentRegistry = environmentRegistry;
export {
  assertRuntimeTarget,
  assertStamp,
  createRuntimeGuard,
  describeDatabaseUrl,
  EnvironmentGuardError,
  pgConnectionConfig,
  readStamp,
  resolveRuntimeEnvironment,
} from './runtime-contract.mjs';
export type { JboxEnvironment } from './runtime-contract.mjs';
