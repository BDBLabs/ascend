/**
 * P3 exit evidence at the application layer: delivery, customer decisions and
 * signed-document evidence through the real modules against a real PostgreSQL.
 *
 *   - delivery is one transaction; links are bound to the draft content hash
 *   - a draft edited after sending cannot be decided through the old link
 *   - two concurrent decisions on one link: exactly one wins, the grant is
 *     consumed with it, one signed event, one evidence row
 *   - the signed page renders from stored evidence: a later configuration
 *     change does not alter it, and a tampered hash surfaces as an integrity
 *     failure instead of silently re-rendering
 *
 * Runs when INTEGRATION_DATABASE_URL / INTEGRATION_OWNER_URL are set (CI
 * isolation job). Skipped otherwise.
 */
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const runtimeUrl = process.env.INTEGRATION_DATABASE_URL;
const ownerUrl = process.env.INTEGRATION_OWNER_URL;

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const CONFIG = (name: string) => ({
  version: 'config-v1',
  templateId: 'heritage-craft',
  catalogVersion: 1,
  brand: { primaryColor: '#1d4ed8', accentColor: '#f59e0b', surfaceColor: '#ffffff' },
  identity: { businessName: name, tagline: 'Licensed electricians' },
  contact: { phone: '(631) 555-0100', email: 'hello@int.test', address: '1 Main St', hours: '9-5' },
  serviceArea: { description: 'Suffolk County' },
  services: [{ slug: 'panels', name: 'Panels', description: 'Panel upgrades.', priceFromCents: 100000 }],
  hero: { headline: 'Headline', subheadline: 'Subheadline' },
  about: { body: 'About us.' },
  documents: { prefixes: { customer: 'CUS', estimate: 'EST', serviceRequest: 'SRQ', job: 'JOB', invoice: 'INV', receipt: 'RCT' } },
  tax: { taxRateMillipercent: 8625 },
});

describe.skipIf(!runtimeUrl || !ownerUrl)('estimate delivery, decisions and signed evidence (real database)', () => {
  let owner: pg.Client;
  const org = randomUUID();
  const customer = randomUUID();
  const estimate = randomUUID();
  let modules: {
    delivery: typeof import('@/lib/estimate-delivery');
    decision: typeof import('@/lib/customer-estimate-decision');
    document: typeof import('@/lib/customer-estimate-document');
    context: typeof import('@/lib/organization-context-store');
  };

  const inTenant = <T,>(work: () => Promise<T>) =>
    modules.context.runWithOrganizationContext({ organizationId: org, actorId: null, requestId: randomUUID() }, work);

  async function deliver() {
    const result = await inTenant(() => modules.delivery.createEstimateDelivery({ estimateId: estimate, timeZone: 'UTC' }));
    expect(result.ok).toBe(true);
    const rows = await owner.query(
      `SELECT payload FROM transactional_outbox WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [org],
    );
    const payload = rows.rows[0].payload as { viewUrl: string; approveUrl: string };
    return {
      view: new URL(payload.viewUrl).pathname.split('/').pop()!,
      sign: new URL(payload.approveUrl).pathname.split('/').pop()!,
    };
  }

  const approve = (token: string, signerName = 'Pat Customer') => inTenant(() =>
    modules.decision.decideCustomerEstimate(token, {
      decision: 'approved', signerName, affirmativeConsent: true, ip: '203.0.113.9', userAgent: 'integration',
    }));

  beforeAll(async () => {
    process.env.DATABASE_URL = runtimeUrl;
    process.env.ASCEND_ENVIRONMENT = process.env.ASCEND_ENVIRONMENT ?? 'ci';
    process.env.CUSTOMER_LINK_SECRET = 'l'.repeat(48);
    process.env.CUSTOMER_LINK_KEY_VERSION = 'v1';
    process.env.RESEND_API_KEY = 're_integration_key_000';

    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query(`INSERT INTO organizations (id, slug, display_name, status) VALUES ($1, $2, 'Int Electric', 'active')`,
      [org, `int-ev-${org.slice(0, 8)}`]);
    await owner.query(`INSERT INTO organization_domains (organization_id, hostname, is_canonical, verified, verified_at)
                       VALUES ($1, $2, true, true, now())`, [org, `int-ev-${org.slice(0, 8)}.useascend.com`]);
    await owner.query(`INSERT INTO configuration_versions (organization_id, version, status, document_version, document, approved_at)
                       VALUES ($1, 1, 'approved', 'config-v1', $2::jsonb, now())`, [org, JSON.stringify(CONFIG('Int Electric'))]);
    await owner.query(`INSERT INTO customers (id, organization_id, document_number, display_id, display_name, email)
                       VALUES ($1, $2, 1, 'INT-CUS-0001', 'Pat Customer', 'pat@example.test')`, [customer, org]);
    await owner.query(`INSERT INTO estimates (id, organization_id, document_number, display_id, customer_id, title, scope,
                         subtotal_cents, taxable_subtotal_cents, taxable_after_discount_cents, total_cents)
                       VALUES ($1, $2, 1, 'INT-EST-0001', $3, 'Panel upgrade', 'Replace the panel.', 100000, 0, 0, 100000)`,
      [estimate, org, customer]);
    await owner.query(`INSERT INTO estimate_line_items (organization_id, estimate_id, position, description,
                         quantity_hundredths, unit_price_cents, line_total_cents)
                       VALUES ($1, $2, 0, 'Panel', 100, 100000, 100000)`, [org, estimate]);

    modules = {
      delivery: await import('@/lib/estimate-delivery'),
      decision: await import('@/lib/customer-estimate-decision'),
      document: await import('@/lib/customer-estimate-document'),
      context: await import('@/lib/organization-context-store'),
    };
  });

  afterAll(async () => {
    await owner?.end();
    const { closeDatabasePool } = await import('@/lib/db');
    await closeDatabasePool();
  });

  it('a draft edited after sending cannot be decided through the old link', async () => {
    const links = await deliver();
    await owner.query(`UPDATE estimates SET scope = 'Replace the panel and the meter.', updated_at = now() WHERE id = $1`, [estimate]);

    const document = await inTenant(() => modules.document.loadCustomerEstimateDocument(links.sign));
    expect(document?.superseded).toBe(true);
    expect(await approve(links.sign)).toEqual({ ok: false, reason: 'superseded' });

    const state = await owner.query('SELECT status FROM estimates WHERE id = $1', [estimate]);
    expect(state.rows[0].status).toBe('draft');
  });

  it('concurrent decisions: exactly one wins, atomically with grant consumption and evidence', async () => {
    const links = await deliver();
    const results = await Promise.all([approve(links.sign, 'Pat One'), approve(links.sign, 'Pat Two'), approve(links.sign, 'Pat Three')]);
    const winners = results.filter((result) => result.ok);
    expect(winners).toHaveLength(1);
    for (const loser of results.filter((result) => !result.ok)) {
      expect(loser).toEqual({ ok: false, reason: 'already-decided' });
    }

    const grant = await owner.query(
      `SELECT status FROM customer_access_grants WHERE document_id = $1 AND purpose = 'sign' AND status <> 'revoked'`, [estimate]);
    expect(grant.rows.map((row) => row.status)).toEqual(['consumed']);
    const events = await owner.query(`SELECT count(*)::int AS n FROM estimate_events WHERE estimate_id = $1 AND event = 'signed'`, [estimate]);
    expect(events.rows[0].n).toBe(1);

    const evidence = await owner.query(
      `SELECT e.canonical_text, e.content_hash, s.content_hash AS estimate_hash, e.consent_text_version, e.delivery_id
         FROM estimate_signed_evidence e JOIN estimates s ON s.id = e.estimate_id WHERE e.estimate_id = $1`, [estimate]);
    const row = evidence.rows[0];
    expect(createHash('sha256').update(row.canonical_text).digest('hex')).toBe(row.content_hash);
    expect(row.estimate_hash).toBe(row.content_hash);
    expect(row.consent_text_version).toBe('estimate-consent-v1');
    expect(row.delivery_id).not.toBeNull();
    const signed = JSON.parse(row.canonical_text);
    expect(signed.business.name).toBe('Int Electric');
    expect(signed.estimate.scope).toBe('Replace the panel and the meter.');
    expect(signed.signature.consentText).toMatch(/electronic signature/);
  });

  it('the signed page renders from evidence, unaffected by later configuration changes', async () => {
    const view = (await owner.query(
      `SELECT id FROM customer_access_grants WHERE document_id = $1 AND purpose = 'view' AND status = 'active'`, [estimate])).rows;
    expect(view).toHaveLength(1);
    // Re-derive nothing: use a fresh delivery-independent view of the stored evidence.
    await owner.query(`UPDATE configuration_versions SET superseded_at = now() WHERE organization_id = $1 AND version = 1`, [org]);
    await owner.query(`INSERT INTO configuration_versions (organization_id, version, status, document_version, document, approved_at)
                       VALUES ($1, 2, 'approved', 'config-v1', $2::jsonb, now())`, [org, JSON.stringify(CONFIG('Renamed Electric LLC'))]);

    const { loadVerifiedEvidence } = await import('@/lib/estimate-evidence');
    const { getEstimate } = await import('@/lib/estimates');
    const record = await inTenant(() => getEstimate(estimate));
    const evidence = await inTenant(() => loadVerifiedEvidence(record!));
    expect(evidence.ok && evidence.document.business.name).toBe('Int Electric');
  });

  it('a tampered hash is reported as an integrity failure, never re-rendered', async () => {
    await owner.query('ALTER TABLE estimates DISABLE TRIGGER estimates_terminal_state');
    try {
      await owner.query(`UPDATE estimates SET content_hash = $2 WHERE id = $1`, [estimate, 'f'.repeat(64)]);
    } finally {
      await owner.query('ALTER TABLE estimates ENABLE TRIGGER estimates_terminal_state');
    }
    const { loadVerifiedEvidence } = await import('@/lib/estimate-evidence');
    const { getEstimate } = await import('@/lib/estimates');
    const record = await inTenant(() => getEstimate(estimate));
    expect(await inTenant(() => loadVerifiedEvidence(record!))).toEqual({ ok: false, reason: 'integrity' });
  });
});
