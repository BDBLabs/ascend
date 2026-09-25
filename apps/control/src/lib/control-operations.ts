import 'server-only';

import { controlQuery } from '@/lib/control-db';

/** Per-tenant health (P5): counts and timestamps only, via control_tenant_health. */
export async function tenantHealth(organizationId: string) {
  const rows = await controlQuery('SELECT * FROM control_tenant_health($1::uuid)', [organizationId]);
  const row = rows[0];
  if (!row) return null;
  const count = (value: unknown) => Number(value ?? 0);
  const time = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
  const outboxSlo = Number(process.env.OUTBOX_PENDING_SLO_SECONDS ?? 900);
  const health = {
    status: String(row.organization_status),
    domains: {
      canonicalVerified: Boolean(row.canonical_domain_verified),
      customUnverified: count(row.custom_domains_unverified),
    },
    configurationApproved: Boolean(row.configuration_approved),
    staff: { active: count(row.active_staff), withMfa: count(row.staff_with_mfa) },
    outbox: {
      pending: count(row.outbox_pending),
      oldestPendingSeconds: count(row.outbox_oldest_pending_seconds),
      dead: count(row.outbox_dead),
    },
    lastSuccess: {
      signIn: time(row.last_sign_in_at),
      delivery: time(row.last_delivery_at),
      signature: time(row.last_signature_at),
    },
    activeCustomerLinks: count(row.active_customer_links),
  };
  const problems: string[] = [];
  if (health.status === 'active' && !health.domains.canonicalVerified) problems.push('canonical domain unverified');
  if (!health.configurationApproved) problems.push('no approved configuration');
  if (health.status === 'active' && health.staff.active === 0) problems.push('no active staff');
  if (health.outbox.dead > 0) problems.push('dead outbox messages');
  if (health.outbox.oldestPendingSeconds > outboxSlo) problems.push('outbox backlog beyond SLO');
  return { ...health, healthy: problems.length === 0, problems };
}

/** Incident response: revoke a tenant's (or one document's) customer links. */
export async function revokeCustomerLinks(actor: string, organizationId: string, documentId: string | null, reason: string) {
  const rows = await controlQuery('SELECT control_revoke_customer_links($1, $2::uuid, $3::uuid, $4) AS revoked',
    [actor, organizationId, documentId, reason]);
  return Number(rows[0]?.revoked ?? 0);
}

/**
 * Self-serve onboarding quota (P5): the service credential may provision at
 * most ONBOARDING_DAILY_QUOTA tenants per rolling 24 hours (default 20),
 * counted from the audit trail, so a leaked or abused onboarding path cannot
 * mint unbounded tenants. Operators are not limited.
 */
export async function onboardingQuotaExceeded(actor: string): Promise<boolean> {
  const quota = Number(process.env.ONBOARDING_DAILY_QUOTA ?? 20);
  const rows = await controlQuery(
    `SELECT count(*)::int AS n FROM identity_audit_events
      WHERE actor = $1 AND action = 'tenant.provision' AND occurred_at > now() - interval '24 hours'`,
    [actor],
  );
  return Number(rows[0]?.n ?? 0) >= quota;
}
