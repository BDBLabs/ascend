import 'server-only';

import {
  customerAccessTokenHasValidSyntax,
  hashCustomerAccessToken,
} from '@/lib/customer-access-tokens';
import { verifyCustomerAccessGrant } from '@/lib/customer-access-grants';
import { db } from '@/lib/db';
import {
  draftContentHash,
  loadVerifiedEvidence,
  type SignedEstimateDocument,
} from '@/lib/estimate-evidence';
import { getEstimate, type EstimateRecord } from '@/lib/estimates';

/**
 * Loads the estimate a customer-access token opens, for the /estimates/[token]
 * page. Accepts either purpose — the view link shows the document, the sign
 * link shows it plus the decision form — and keeps a consumed sign link
 * viewable so a customer who already responded can see the outcome.
 */

export type CustomerEstimateDocument = {
  estimate: EstimateRecord;
  purpose: 'view' | 'sign';
  expiresAt: string;
  /** The draft changed after this link was sent; it can no longer be decided. */
  superseded: boolean;
  /**
   * For a signed estimate: the verified stored evidence (what was signed,
   * including the business identity shown), or 'integrity-failure' when the
   * stored text, its hash and the estimate disagree. Never current config.
   */
  signed: SignedEstimateDocument | 'integrity-failure' | null;
};

type GrantRow = {
  id: string;
  document_id: string;
  purpose: 'view' | 'sign';
};

export async function loadCustomerEstimateDocument(
  token: string,
): Promise<CustomerEstimateDocument | null> {
  if (!customerAccessTokenHasValidSyntax(token)) return null;

  // Token-only URL: resolve the grant first (RLS-scoped to the tenant context
  // the customer host established), then run canonical verification.
  const rows = (await db().query(
    `SELECT access_grant.id, access_grant.document_id, access_grant.purpose
       FROM customer_access_grants AS access_grant
      WHERE access_grant.token_hash = $1
        AND access_grant.document_type = 'estimate'
      LIMIT 1`,
    [hashCustomerAccessToken(token)],
  )) as GrantRow[];
  const grant = rows[0];
  if (!grant) return null;

  const verified = await verifyCustomerAccessGrant({
    token,
    documentType: 'estimate',
    documentId: grant.document_id,
    resourceVersionId: null,
    purpose: grant.purpose === 'sign' ? 'estimate.sign' : 'estimate.view',
    allowConsumed: true,
  });
  if (!verified.ok) return null;

  const estimate = await getEstimate(grant.document_id);
  if (!estimate) return null;

  let signed: CustomerEstimateDocument['signed'] = null;
  if (estimate.status === 'signed') {
    const evidence = await loadVerifiedEvidence(estimate);
    // Estimates signed before migration 037 have no evidence row; everything
    // signed since must verify, and a mismatch is surfaced, never papered over.
    signed = evidence.ok ? evidence.document : evidence.reason === 'integrity' ? 'integrity-failure' : null;
  }

  return {
    estimate,
    purpose: grant.purpose,
    expiresAt: verified.grant.expiresAt,
    superseded: estimate.status === 'draft'
      && verified.grant.resourceVersion !== null
      && verified.grant.resourceVersion !== draftContentHash(estimate),
    signed,
  };
}
