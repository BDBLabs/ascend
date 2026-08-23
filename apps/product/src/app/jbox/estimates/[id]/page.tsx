import Link from 'next/link';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getEstimate } from '@/lib/estimates';

export const dynamic = 'force-dynamic';

const S = {
  backLink: { color: '#94a3b8', textDecoration: 'none', fontSize: '0.875rem' } as const,
  heading: { fontSize: '1.5rem', fontWeight: 900, color: '#f59e0b', margin: 0 } as const,
  subtitle: { color: '#94a3b8', fontSize: '0.875rem', margin: '4px 0 0' } as const,
  card: { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '24px', marginBottom: '20px' } as const,
  sectionTitle: { fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#f59e0b', margin: '0 0 16px' } as const,
  badge: (bg: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: bg, color: '#0f172a' }) as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' } as const,
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #334155', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' } as const,
  td: { padding: '8px 12px', borderBottom: '1px solid #1e293b', color: '#cbd5e1' } as const,
  muted: { color: '#64748b', fontSize: '0.8125rem' } as const,
  price: { fontFamily: 'ui-monospace, monospace', textAlign: 'right' as const },
  totalRow: { fontWeight: 900, fontSize: '1rem' } as const,
  actions: { display: 'flex', gap: '12px', flexWrap: 'wrap' as const },
  btnPrimary: { display: 'inline-block', padding: '10px 20px', background: '#f59e0b', color: '#0f172a', borderRadius: '6px', fontWeight: 900, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', textDecoration: 'none', border: 'none', cursor: 'pointer' } as const,
  btnSecondary: { display: 'inline-block', padding: '10px 20px', background: '#334155', color: '#cbd5e1', borderRadius: '6px', fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', textDecoration: 'none', border: '2px solid #475569', cursor: 'pointer' } as const,
};

const STATUS_BG: Record<string, string> = {
  draft: '#64748b',
  signed: '#10b981',
  declined: '#ef4444',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  signed: 'Approved / Signed',
  declined: 'Declined',
};

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return (
      <div style={{ padding: '2rem', color: '#ef4444', fontSize: '0.875rem' }}>
        Your staff role does not include access to estimates.
      </div>
    );
  }

  if (!isDatabaseConfigured()) {
    return (
      <div>
        <a href="/jbox/estimates" style={S.backLink}>&larr; All Estimates</a>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '24px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Database not configured
          </p>
        </div>
      </div>
    );
  }

  const estimate = await withFieldContext(principal, () => getEstimate(id));

  if (!estimate) {
    return (
      <div>
        <a href="/jbox/estimates" style={S.backLink}>&larr; All Estimates</a>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '24px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Estimate not found
          </p>
        </div>
      </div>
    );
  }

  const lineItems = estimate.lineItems ?? [];
  const subtotalCents = lineItems.reduce((sum, li) => sum + li.lineTotalCents, 0);
  const taxCents = Math.round(subtotalCents * (estimate.taxRateMillipercent / 100000));
  const totalCents = subtotalCents + taxCents + estimate.surchargeCents - Math.round(subtotalCents * (estimate.discountMillipercent / 100000));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <a href="/jbox/estimates" style={S.backLink}>&larr; All Estimates</a>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
            <h1 style={S.heading}>{estimate.displayId}</h1>
            <span style={S.badge(STATUS_BG[estimate.status] ?? '#64748b')}>
              {STATUS_LABELS[estimate.status] ?? estimate.status}
            </span>
          </div>
          {estimate.title && <p style={S.subtitle}>{estimate.title}</p>}
          <p style={S.muted}>
            {estimate.customer.name} &middot; {estimate.customer.town}
            {estimate.customer.phone && <> &middot; {estimate.customer.phone}</>}
          </p>
        </div>
      </div>

      <div style={S.actions}>
        <a href={`/jbox/estimates/${id}/sketch`} style={S.btnPrimary}>Open Sketch Canvas</a>
      </div>

      {(estimate.scope || estimate.notes) && (
        <div style={{ ...S.card, marginTop: '24px' }}>
          <h2 style={S.sectionTitle}>Scope of Work &amp; Fixed Estimate</h2>
          {estimate.scope && <p style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{estimate.scope}</p>}
          {!estimate.scope && estimate.notes && <p style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{estimate.notes}</p>}
        </div>
      )}

      {lineItems.length > 0 && (
        <div style={{ ...S.card, marginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Labor &amp; Field Operations</h2>
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
                  <td style={{ ...S.td, fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#f59e0b' }}>
                    {li.itemCode}
                  </td>
                  <td style={S.td}>{li.description}</td>
                  <td style={{ ...S.td, ...S.price }}>{(li.quantityHundredths / 100).toFixed(2)}</td>
                  <td style={{ ...S.td, ...S.price }}>${(li.unitPriceCents / 100).toFixed(2)}</td>
                  <td style={{ ...S.td, ...S.price, fontWeight: 600 }}>${(li.lineTotalCents / 100).toFixed(2)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} style={{ ...S.td, ...S.totalRow, textAlign: 'right', color: '#94a3b8' }}>Total</td>
                <td style={{ ...S.td, ...S.totalRow, ...S.price, color: '#f59e0b' }}>${(estimate.totals.totalCents / 100).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {lineItems.length === 0 && !estimate.scope && (
        <div style={{ ...S.card, marginTop: '20px', textAlign: 'center' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No line items or scope yet — open the sketch canvas to start building this estimate
          </p>
        </div>
      )}
    </div>
  );
}
