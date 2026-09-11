import 'server-only';

import { DEFAULT_DOCUMENT_PREFIXES } from '@contractor-platform/configuration';
import { computeTotals } from '@contractor-platform/money';
import { db } from '@/lib/db';
import { requireOrganizationContext } from '@/lib/organization-context-store';
import { formatCents, loadInForceConfig } from '@/lib/tenant';
import { buildApplicationInvoiceLines } from './billing-contract';
import {
  getApplication,
  markApplicationInvoiced,
} from './progress-billing';

/**
 * Commercial loop: turns an approved progress application into a draft
 * J-Box invoice. The invoice engine is reused unchanged — one positive,
 * non-taxable line for the amount due, totals via the money package, the
 * existing document-number allocation — so the invoice total agrees with
 * the frozen billing snapshot by construction. The application link and
 * period close go through markApplicationInvoiced, the same path as a
 * manually linked invoice.
 */

export type CreateApplicationInvoiceResult =
  | { ok: true; invoiceId: string; reused: boolean }
  | {
      ok: false;
      error:
        | 'application-not-found'
        | 'not-approved'
        | 'nothing-due'
        | 'invoice-not-found';
    };

export async function createInvoiceForApplication(
  applicationId: string,
): Promise<CreateApplicationInvoiceResult> {
  const application = await getApplication(applicationId);
  if (!application) return { ok: false, error: 'application-not-found' };
  if (application.status === 'invoiced' && application.invoiceId) {
    return { ok: true, invoiceId: application.invoiceId, reused: true };
  }
  if (application.status !== 'approved') {
    return { ok: false, error: 'not-approved' };
  }
  if (application.currentDueCents <= 0) {
    // Invoice lines cannot post credits; a zero/credit application has
    // nothing to invoice.
    return { ok: false, error: 'nothing-due' };
  }

  const lines = buildApplicationInvoiceLines({
    displayId: application.projectDisplayId,
    periodNumber: application.periodNumber,
    currentDueCents: application.currentDueCents,
  });
  const totals = computeTotals(
    lines.map((l) => ({
      unitPriceCents: l.amountCents,
      quantityHundredths: 100,
      taxable: false,
    })),
    { discountMillipercent: 0, surchargeCents: 0, taxRateMillipercent: 0 },
    1,
  );

  const sql = db();
  const actorId = requireOrganizationContext().actorId;
  const config = await loadInForceConfig();
  const prefix =
    config?.documents.prefixes.invoice ?? DEFAULT_DOCUMENT_PREFIXES.invoice;
  const line = lines[0];
  if (!line) throw new Error('Application produced no invoice lines.');
  const title = `Progress billing ${application.projectDisplayId} — application #${application.periodNumber}`;

  const inserted = (await sql.query(
    `WITH allocated AS (
       SELECT allocate_document_number('invoice') AS n
     )
     INSERT INTO invoices
       (organization_id, document_number, display_id, customer_id,
        status, title, notes,
        discount_millipercent, surcharge_cents, tax_rate_millipercent, deposit_cents,
        subtotal_cents, taxable_subtotal_cents, discount_cents,
        taxable_after_discount_cents, tax_cents, total_cents, money_version)
     SELECT app_require_organization_id(), allocated.n,
            $1 || lpad(allocated.n::text, 4, '0'),
            project.customer_id,
            'draft', $2, $3,
            0, 0, 0, 0,
            $4, 0, 0, $4, 0, $4, 1
     FROM allocated
     JOIN modernization_projects AS project
       ON project.id = $5::uuid
      AND project.organization_id = app_require_organization_id()
     RETURNING id`,
    [
      `${prefix}-`,
      title,
      `Earned ${formatCents(application.earnedValueCents)}, previously billed ${formatCents(application.previouslyBilledCents)}, retainage held ${formatCents(application.retainageCents)}, stored materials ${formatCents(application.storedMaterialsCents)}.`,
      totals.totalCents,
      application.projectId,
    ],
  )) as Array<{ id: string }>;
  const invoiceRow = inserted[0];
  if (!invoiceRow) return { ok: false, error: 'application-not-found' };

  await sql.query(
    `INSERT INTO invoice_line_items
       (organization_id, invoice_id, position, item_code, description,
        quantity_hundredths, unit_price_cents, taxable, line_total_cents)
     VALUES
       (app_require_organization_id(), $1::uuid, 0, 'PROG', $2,
        100, $3, false, $3)`,
    [invoiceRow.id, line.description, line.amountCents],
  );

  await sql.query(
    `INSERT INTO invoice_events (organization_id, invoice_id, event, actor_id, meta)
     VALUES (app_require_organization_id(), $1::uuid, 'created', $2::uuid,
             jsonb_build_object('progress_application_id', $3::text,
                                'project_id', $4::text))`,
    [invoiceRow.id, actorId, applicationId, application.projectId],
  );

  const linked = await markApplicationInvoiced(applicationId, invoiceRow.id);
  if (!linked.ok) return { ok: false, error: 'invoice-not-found' };
  return { ok: true, invoiceId: invoiceRow.id, reused: false };
}
