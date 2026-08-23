import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getInvoice, getInvoiceLines } from '@/lib/invoices';
import {
  COLORS,
  FONT,
  STATUS_LABELS,
  card,
  heading,
  muted,
  statusBadge,
  subtitle,
  table,
  td,
  th,
} from '../../jbox-tokens';

export const dynamic = 'force-dynamic';

const S = {
  backLink: { color: COLORS.textMuted, textDecoration: 'none', fontSize: '0.875rem' } as const,
  heading: { ...heading, margin: '8px 0 0' },
  subtitle: { ...subtitle, marginTop: '4px' },
  card: { ...card, padding: '24px', marginBottom: '20px' },
  sectionTitle: { fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.amber, margin: '0 0 16px' } as const,
  infoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px' } as const,
  infoLabel: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.textDim, margin: '0 0 4px' } as const,
  infoValue: { color: COLORS.textSecondary, fontSize: '0.875rem', margin: 0 } as const,
  table,
  th: { ...th, padding: '8px 12px' },
  td: { ...td, padding: '8px 12px' },
  price: { fontFamily: FONT.mono, textAlign: 'right' as const },
  totalRow: { fontWeight: 900, fontSize: '1rem' } as const,
};

export default async function JBoxInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'invoices.read')) {
    return (
      <div style={{ padding: '2rem', color: '#ef4444', fontSize: '0.875rem' }}>
        Your staff role does not include access to invoices.
      </div>
    );
  }

  if (!isDatabaseConfigured()) {
    return (
      <div>
        <a href="/jbox/invoices" style={S.backLink}>&larr; All Invoices</a>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '24px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Database not configured
          </p>
        </div>
      </div>
    );
  }

  const invoice = await withFieldContext(principal, () => getInvoice(id));

  if (!invoice) {
    return (
      <div>
        <a href="/jbox/invoices" style={S.backLink}>&larr; All Invoices</a>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '24px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Invoice not found
          </p>
        </div>
      </div>
    );
  }

  const lineItems = await withFieldContext(principal, () => getInvoiceLines(invoice.id));

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <a href="/jbox/invoices" style={S.backLink}>&larr; All Invoices</a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={S.heading}>{invoice.displayId}</h1>
          <span style={statusBadge(invoice.status)}>
            {STATUS_LABELS[invoice.status] ?? invoice.status}
          </span>
        </div>
        <p style={S.subtitle}>{invoice.title}</p>
        {invoice.customerId ? (
          <p style={muted}>
            Customer:{' '}
            <a href={`/jbox/customers/${invoice.customerId}`} style={{ ...muted, color: COLORS.amber, textDecoration: 'none', fontWeight: 600 }}>
              {invoice.customerName}
            </a>
          </p>
        ) : (
          invoice.customerName && <p style={muted}>Customer: {invoice.customerName}</p>
        )}
      </div>

      {(invoice.dueAt || invoice.depositCents || invoice.amountPaidCents) && (
        <div style={S.card}>
          <h2 style={S.sectionTitle}>Payment</h2>
          <div style={S.infoGrid}>
            {invoice.dueAt && (
              <div>
                <p style={S.infoLabel}>Due Date</p>
                <p style={S.infoValue}>{new Date(invoice.dueAt).toLocaleDateString()}</p>
              </div>
            )}
            {invoice.depositCents > 0 && (
              <div>
                <p style={S.infoLabel}>Deposit</p>
                <p style={{ ...S.infoValue, fontFamily: FONT.mono }}>${(invoice.depositCents / 100).toFixed(2)}</p>
              </div>
            )}
            {invoice.amountPaidCents > 0 && (
              <div>
                <p style={S.infoLabel}>Amount Paid</p>
                <p style={{ ...S.infoValue, fontFamily: FONT.mono }}>${(invoice.amountPaidCents / 100).toFixed(2)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {lineItems.length > 0 && (
        <div style={S.card}>
          <h2 style={S.sectionTitle}>Line Items</h2>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Code</th>
                <th style={S.th}>Description</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Qty</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Unit Price</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.id}>
                  <td style={{ ...S.td, fontFamily: FONT.mono, fontWeight: 600, color: '#f59e0b' }}>
                    {li.itemCode}
                  </td>
                  <td style={S.td}>
                    {li.description}
                    {!li.taxable && <span style={muted}> (non-taxable)</span>}
                  </td>
                  <td style={{ ...S.td, ...S.price }}>{(li.quantityHundredths / 100).toFixed(2)}</td>
                  <td style={{ ...S.td, ...S.price }}>${(li.unitPriceCents / 100).toFixed(2)}</td>
                  <td style={{ ...S.td, ...S.price, fontWeight: 600 }}>${(li.lineTotalCents / 100).toFixed(2)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} style={{ ...S.td, ...S.totalRow, textAlign: 'right', color: '#94a3b8' }}>Total</td>
                <td style={{ ...S.td, ...S.totalRow, ...S.price, color: '#f59e0b' }}>${(invoice.totals.totalCents / 100).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {lineItems.length === 0 && !invoice.notes && (
        <div style={S.card}>
          <h2 style={S.sectionTitle}>Line Items</h2>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No line items on this invoice yet.
          </p>
        </div>
      )}

      {(invoice.notes || invoice.estimateId || invoice.jobId) && (
        <div style={S.card}>
          <h2 style={S.sectionTitle}>Record</h2>
          {invoice.notes && <p style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: '0 0 16px' }}>{invoice.notes}</p>}
          <div style={S.infoGrid}>
            {invoice.estimateId && (
              <div>
                <p style={S.infoLabel}>Estimate</p>
                <p style={S.infoValue}>
                  <a href={`/jbox/estimates/${invoice.estimateId}`} style={{ color: COLORS.amber, textDecoration: 'none', fontWeight: 600 }}>
                    {invoice.estimateId.slice(0, 8)}...
                  </a>
                </p>
              </div>
            )}
            {invoice.jobId && (
              <div>
                <p style={S.infoLabel}>Work Order</p>
                <p style={S.infoValue}>
                  <a href={`/jbox/jobs/${invoice.jobId}`} style={{ color: COLORS.amber, textDecoration: 'none', fontWeight: 600 }}>
                    {invoice.jobId.slice(0, 8)}...
                  </a>
                </p>
              </div>
            )}
            <div>
              <p style={S.infoLabel}>Created</p>
              <p style={{ ...S.infoValue, ...muted }}>{new Date(invoice.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p style={S.infoLabel}>Updated</p>
              <p style={{ ...S.infoValue, ...muted }}>{new Date(invoice.updatedAt).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
