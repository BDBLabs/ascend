import 'server-only';

import { createHash } from 'node:crypto';
import type { ConfigV1 } from '@contractor-platform/configuration';
import { db } from '@/lib/db';
import { canonicalize } from '@/lib/estimate-document';
import type { EstimateRecord } from '@/lib/estimate-record';

/**
 * Signed-estimate evidence (P3.1, migration 037).
 *
 * At signing, ONE canonical JSON document is built from everything the signer
 * was shown and agreed to: the estimate content, the governing configuration
 * version and the business identity/contact rendered on the page, the consent
 * statement (text + version), the signer and the signature time. Its exact
 * canonical text is stored with its SHA-256; the database refuses a row whose
 * hash is not the digest of its text, and the estimate's content_hash is the
 * same digest. Signed pages render from this stored text -- never from current
 * configuration -- and re-verify the digest on every read.
 */

export const SIGNED_SCHEMA_VERSION = 'signed-estimate-v1';
export const HASH_ALGORITHM = 'sha256-canonical-json-v1';

// Versioned consent statement. Changing the wording REQUIRES a new version:
// historical evidence records the version and the exact text it showed.
export const CONSENT_TEXT_VERSION = 'estimate-consent-v1';
export const CONSENT_TEXT =
  'By typing my name and approving, I accept this estimate exactly as shown, including its scope, '
  + 'exclusions, prices and totals, and I understand this is an electronic signature.';

/** The draft content a customer is shown. Its hash binds delivery links. */
export function estimateContent(estimate: EstimateRecord) {
  return {
    displayId: estimate.displayId,
    documentTemplateVersion: estimate.documentTemplateVersion,
    customer: estimate.customer,
    scope: estimate.scope,
    exclusions: estimate.exclusions,
    discountMillipercent: estimate.discountMillipercent,
    surchargeCents: estimate.surchargeCents,
    taxRateMillipercent: estimate.taxRateMillipercent,
    depositCents: estimate.depositCents,
    moneyVersion: estimate.moneyVersion,
    lineItems: estimate.lineItems,
    totals: estimate.totals,
  };
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Hash of the current draft content (the resource version a link is bound to). */
export function draftContentHash(estimate: EstimateRecord): string {
  return sha256Hex(canonicalize(estimateContent(estimate)));
}

export type SignedBusiness = {
  name: string;
  phone: string;
  email: string;
  address: string;
  configurationVersionId: string | null;
  configurationVersion: number | null;
};

export type SignedEstimateDocument = {
  schema: typeof SIGNED_SCHEMA_VERSION;
  estimate: ReturnType<typeof estimateContent>;
  business: SignedBusiness;
  signature: {
    signerName: string;
    signedAt: string;
    context: string;
    consentTextVersion: string;
    consentText: string;
    deliveryId: string | null;
    draftContentHash: string;
  };
};

export function businessFromConfig(
  config: ConfigV1 | null,
  record: { id: string; version: number } | null,
): SignedBusiness {
  return {
    name: config?.identity.businessName ?? '',
    phone: config?.contact.phone ?? '',
    email: config?.contact.email ?? '',
    address: config?.contact.address ?? '',
    configurationVersionId: record?.id ?? null,
    configurationVersion: record?.version ?? null,
  };
}

export function buildSignedDocument(options: {
  estimate: EstimateRecord;
  business: SignedBusiness;
  signerName: string;
  signedAt: string;
  context: string;
  deliveryId: string | null;
}): { document: SignedEstimateDocument; canonicalText: string; hash: string } {
  const document: SignedEstimateDocument = {
    schema: SIGNED_SCHEMA_VERSION,
    estimate: estimateContent(options.estimate),
    business: options.business,
    signature: {
      signerName: options.signerName,
      signedAt: options.signedAt,
      context: options.context,
      consentTextVersion: CONSENT_TEXT_VERSION,
      consentText: CONSENT_TEXT,
      deliveryId: options.deliveryId,
      draftContentHash: draftContentHash(options.estimate),
    },
  };
  const canonicalText = canonicalize(document);
  return { document, canonicalText, hash: sha256Hex(canonicalText) };
}

export type VerifiedEvidence =
  | { ok: true; document: SignedEstimateDocument; hash: string }
  | { ok: false; reason: 'missing' | 'integrity' };

/**
 * Loads and verifies the evidence for a signed estimate. 'integrity' means the
 * stored text, its hash, and the estimate's hash disagree -- the caller must
 * show an integrity failure, never fall back to current data.
 */
export async function loadVerifiedEvidence(estimate: EstimateRecord): Promise<VerifiedEvidence> {
  const rows = (await db().query(
    `SELECT canonical_text, content_hash, hash_algorithm
       FROM estimate_signed_evidence
      WHERE estimate_id = $1::uuid`,
    [estimate.id],
  )) as Array<{ canonical_text: string; content_hash: string; hash_algorithm: string }>;
  const row = rows[0];
  if (!row) return { ok: false, reason: 'missing' };
  if (
    row.hash_algorithm !== HASH_ALGORITHM
    || sha256Hex(row.canonical_text) !== row.content_hash
    || row.content_hash !== estimate.contentHash
  ) {
    return { ok: false, reason: 'integrity' };
  }
  try {
    const document = JSON.parse(row.canonical_text) as SignedEstimateDocument;
    if (document.schema !== SIGNED_SCHEMA_VERSION) return { ok: false, reason: 'integrity' };
    return { ok: true, document, hash: row.content_hash };
  } catch {
    return { ok: false, reason: 'integrity' };
  }
}
