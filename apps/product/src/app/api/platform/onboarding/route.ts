import type { NextRequest } from 'next/server';
import {
  OnboardingError,
  buildProvisionContract,
  provisionTenantViaControlPlane,
  validateSubmitInput,
} from '@/lib/onboarding';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimitWithFallback } from '@/lib/redis-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/onboarding — the self-serve signup. Validates the wizard
 * input, builds the provisioning contract, and hands it to the control plane,
 * which creates the tenant atomically in 'provisioning' state. The storefront
 * stays offline until DNS is verified and the tenant is activated (by design).
 *
 * A hidden honeypot field ('company_website') catches bots: a filled value is
 * answered with a success-shaped response and writes nothing.
 */
/**
 * True when the raw request body carries a populated `company_website` honeypot
 * field. Checked on the RAW body, not after JSON parsing, so that a bot sending
 * an imperfectly-formed payload is still answered with the success-shaped
 * response instead of tripping a JSON 400 (see #39).
 */
/** Exported for tests; used only by the onboarding POST handler. */
export function honeypotTriggered(raw: string): boolean {
  const match = /"?company_website"?\s*[:=]\s*"([^"]*)"/.exec(raw);
  return Boolean(match && match[1].trim().length > 0);
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return Response.json({ ok: false, error: 'request body must be JSON' }, { status: 400 });
  }

  // Fire the honeypot on the raw body BEFORE requiring valid JSON or running the
  // rate limiter, so bots are quietly answered without consuming provisioning
  // work or a rate-limit slot.
  if (honeypotTriggered(raw)) {
    return Response.json({ ok: true, tenant: null }, { status: 201 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return Response.json({ ok: false, error: 'request body must be JSON' }, { status: 400 });
  }

  if (!(await rateLimitWithFallback(`onboarding:submit:${ip}`, { capacity: 5, refillPerMinute: 0.1 }))) {
    return Response.json({ ok: false, error: 'Too many signups from this address. Try again later.' }, { status: 429 });
  }

  try {
    const input = validateSubmitInput(body);
    const contract = buildProvisionContract(input);
    const tenant = await provisionTenantViaControlPlane(contract);
    return Response.json(
      {
        ok: true,
        tenant,
        next: 'We are setting up your storefront. Activation follows after domain verification.',
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof OnboardingError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    return Response.json({ ok: false, error: 'signup could not be completed right now' }, { status: 500 });
  }
}
