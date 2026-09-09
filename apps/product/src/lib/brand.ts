/**
 * Deployment brand. The same codebase serves J-Box (trade contractors)
 * and Ascend (elevator modernization); ASCEND_MODE=1 flips the
 * user-visible workspace brand and retires the obsolete J-Box surfaces.
 * Dependency-free so the proxy layer can share it. Pure string logic —
 * unit tested without a database.
 */

export function isAscendMode(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (environment.ASCEND_MODE ?? '').trim() === '1';
}

export function brandName(environment: NodeJS.ProcessEnv = process.env): string {
  return isAscendMode(environment) ? 'Ascend' : 'J-Box';
}

/** "Ascend Field" / "J-Box Field" — the staff workspace eyebrow. */
export function brandFieldEyebrow(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return `${brandName(environment)} Field`;
}

export function brandTagline(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return isAscendMode(environment)
    ? 'Workspace for elevator modernization.'
    : 'Staff workspace for trade contractors.';
}

/**
 * Route prefixes retired on Ascend deployments (the obsolete J-Box
 * dashboard and trade-dispatch portal). Field, platform fallback, APIs,
 * and tenant storefronts are unaffected.
 */
const RETIRED_PREFIXES = ['/jbox', '/dispatch'];

export function isRetiredAscendRoute(pathname: string): boolean {
  return RETIRED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
