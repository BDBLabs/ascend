import 'server-only';

import {
  customerAccessTokenKeyVersion,
  customerAccessTokensConfigured,
  deriveCustomerAccessToken,
  hashCustomerAccessToken,
} from '@/lib/customer-access-tokens';
import { db } from '@/lib/db';
import { draftContentHash } from '@/lib/estimate-evidence';
import {
  getEstimate,
  type EstimateRecord,
} from '@/lib/estimates';
import {
  requireOrganizationContext,
} from '@/lib/organization-context-store';
import {
  isResendConfigured,
  type EstimateDeliveryPayload,
} from '@/lib/outbox-dispatch';
import { loadInForceConfig } from '@/lib/tenant';

/**
 * Estimate customer delivery, ascend's equivalent of the prototype's
 * createEstimateDelivery. ascend has no version tables, price book, PDF
 * artifacts, or private storage: the estimate itself is the document, and
 * "delivery" means issuing the customer access links and queuing the
 * self-contained estimate_delivery email for the transactional-outbox drain.
 *
 * Runs in Field context (withFieldContext), so db() is RLS-scoped and the
 * canonical hostname for the link URLs is read from organization_domains.
 * Link URLs point at the tenant subdomain (https://<canonical hostname>/...).
 */

const ESTIMATE_LINK_DAYS = 14;
export const DEFAULT_ESTIMATE_TIME_ZONE = 'America/New_York';

export type EstimateDeliveryResult =
  | {
      ok: true;
      estimate: EstimateRecord;
      delivery: { status: 'queued'; expiresAt: string };
    }
  | { ok: false; reason:
      | 'estimate-not-found'
      | 'estimate-not-draft'
      | 'customer-email-missing'
      | 'delivery-not-configured'
      | 'link-tokens-not-configured'
      | 'tenant-host-not-found'
      | 'estimate-changed' };

function daysAfter(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isUsableEmail(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 320;
}

export async function createEstimateDelivery(options: {
  estimateId: string;
  timeZone: string;
}): Promise<EstimateDeliveryResult> {
  const context = requireOrganizationContext();

  const estimate = await getEstimate(options.estimateId);
  if (!estimate) return { ok: false, reason: 'estimate-not-found' };
  if (estimate.status !== 'draft') return { ok: false, reason: 'estimate-not-draft' };
  if (!isUsableEmail(estimate.customer.email)) {
    return { ok: false, reason: 'customer-email-missing' };
  }

  const config = await loadInForceConfig();
  if (!config || !isUsableEmail(config.contact.email)) {
    return { ok: false, reason: 'delivery-not-configured' };
  }
  if (!isResendConfigured()) {
    return { ok: false, reason: 'delivery-not-configured' };
  }
  if (!customerAccessTokensConfigured()) {
    return { ok: false, reason: 'link-tokens-not-configured' };
  }

  const domainRows = (await db().query(
    `SELECT domain.hostname
       FROM organization_domains AS domain
      WHERE domain.organization_id = app_current_organization_id()
        AND domain.verified
        AND domain.is_canonical
      LIMIT 1`,
  )) as Array<{ hostname: string }>;
  const hostname = domainRows[0]?.hostname;
  if (!hostname) return { ok: false, reason: 'tenant-host-not-found' };

  const issuedAt = new Date();
  const expiresAt = daysAfter(issuedAt, ESTIMATE_LINK_DAYS);
  const expiresAtIso = expiresAt.toISOString();

  // Both approve and decline ride the single sign-purpose link; the page uses
  // the intent query parameter to preselect the customer's choice.
  const baseUrl = `https://${hostname}`;

  // Tokens are derived here (the HMAC key never reaches the database) and bound
  // to the draft's content hash, so editing the draft invalidates the links.
  const deliveryId = crypto.randomUUID();
  const contentHash = draftContentHash(estimate);
  const keyVersion = customerAccessTokenKeyVersion();
  const organizationId = context.organizationId;
  function grant(purpose: 'estimate.view' | 'estimate.sign') {
    const id = crypto.randomUUID();
    const token = deriveCustomerAccessToken({
      grantId: id,
      organizationId,
      resourceInternalId: estimate!.id,
      resourceVersionId: contentHash,
      purpose,
      keyVersion,
    });
    return { id, token, hash: hashCustomerAccessToken(token) };
  }
  const view = grant('estimate.view');
  const sign = grant('estimate.sign');

  const payload: EstimateDeliveryPayload = {
    displayId: estimate.displayId,
    customerEmail: estimate.customer.email,
    from: config.contact.email,
    replyTo: config.contact.email,
    companyName: config.identity.businessName,
    timeZone: options.timeZone,
    expiresAt: expiresAtIso,
    viewUrl: `${baseUrl}/estimates/${view.token}`,
    approveUrl: `${baseUrl}/estimates/${sign.token}?intent=approve`,
    declineUrl: `${baseUrl}/estimates/${sign.token}?intent=decline`,
  };

  try {
    await db().query(
      `SELECT create_estimate_delivery(
         $1::uuid, $2::uuid, $3::timestamptz, $4::text, $5::text, $6::uuid,
         $7::uuid, $8::text, $9::uuid, $10::text, $11::text, $12::timestamptz,
         $13::uuid, $14::jsonb)`,
      [
        deliveryId, estimate.id, estimate.updatedAt, contentHash, estimate.customer.email,
        estimate.customerId, view.id, view.hash, sign.id, sign.hash, keyVersion,
        expiresAtIso, context.actorId, JSON.stringify(payload),
      ],
    );
  } catch (error) {
    if (error instanceof Error && /estimate_changed/.test(error.message)) {
      return { ok: false, reason: 'estimate-changed' };
    }
    throw error;
  }

  return {
    ok: true,
    estimate,
    delivery: { status: 'queued', expiresAt: expiresAtIso },
  };
}
