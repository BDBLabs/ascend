/**
 * Next calls register() once per server process, before handling requests.
 *
 * The runtime guard matters: instrumentation also runs in the edge runtime,
 * which has no process signals and no pg pool, and importing the database
 * module there would fail the build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // P0.1: a production deployment with a demo-principal variable must not
  // serve a single request.
  const { assertNoDemoPrincipalInProduction } = await import('@/lib/field-api-auth');
  assertNoDemoPrincipalInProduction();

  // P5: every console.* call in the app (and its dependencies) is scrubbed of
  // credentials and bearer links before it reaches the log drain.
  const { redactValue } = await import('@/lib/logger');
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => original(...args.map((arg) => redactValue(arg)));
  }

  const { registerShutdownHandlers } = await import('@/lib/shutdown');
  registerShutdownHandlers();
}
