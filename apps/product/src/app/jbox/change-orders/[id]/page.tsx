import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getChangeOrder, getChangeOrderLines } from '@/lib/change-orders';
import { changeOrderStatusLabel } from '@/lib/change-order-contract';
import {
  COLORS,
  FONT,
  card,
  heading,
  muted,
  subtitle,
  table,
  td,
  th,
} from '../../jbox-tokens';

export const dynamic = 'force-dynamic';

const S = {
  backLink: { color: COLORS.textMuted, textDecoration: 'none', fontSize: '0.875rem' } as const,
  heading: { ...heading, margin: '8px 0 0' },
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

const ACTION_COLORS: Record<string, string> = {
  add: '#10b981',
  modify: '#f59e0b',
  remove: '#ef4444',
};

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  draft: { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' },
  pending_approval: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  approved: { bg: 'rgba(16,185,129,0.15)', color: '#10b981' },
  rejected: { bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
};

export default async function JBoxChangeOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return (
      <div style={{ padding: '2rem', color: '#ef4444', fontSize: '0.875rem' }}>
        Your staff role does not include access to change orders.
      </div>
    );
  }

  if (!isDatabaseConfigured()) {
    return (
      <div>
        <a href="/jbox/change-orders" style={S.backLink}>&larr; Change Orders</a>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '24px' }}>
          <p style={{ color: COLORS.textDim, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Database not configured
          </p>
        </div>
      </div>
    );
  }

  const order = await withFieldContext(principal, () => getChangeOrder(id));

  if (!order) {
    return (
      <div>
        <a href="/jbox/change-orders" style={S.backLink}>&larr; Change Orders</a>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '24px' }}>
          <p style={{ color: COLORS.textDim, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Change order not found
          </p>
        </div>
      </div>
    );
  }

  const lines = await withFieldContext(principal, () => getChangeOrderLines(id));
  const statusStyle = STATUS_STYLES[order.status] ?? STATUS_STYLES.draft;

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <a href="/jbox/change-orders" style={S.backLink}>&larr; Change Orders</a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={S.heading}>{order.displayId}</h1>
          <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: statusStyle.bg, color: statusStyle.color }}>
            {changeOrderStatusLabel(order.status)}
          </span>
        </div>
        <p style={subtitle}>{order.title}</p>
        {order.estimateId && (
          <p style={muted}>
            Estimate:{' '}
            <a href={`/jbox/estimates/${order.estimateId}`} style={{ color: COLORS.amber, textDecoration: 'none', fontWeight: 600 }}>
              {order.estimateId.slice(0, 8)}...
            </a>
          </p>
        )}
      </div>

      <div style={S.card}>
        <h2 style={S.sectionTitle}>Summary</h2>
        <div style={S.infoGrid}>
          <div>
            <p style={S.infoLabel}>Original Total</p>
            <p style={{ ...S.infoValue, fontFamily: FONT.mono }}>${(order.originalTotalCents / 100).toFixed(2)}</p>
          </div>
          <div>
            <p style={S.infoLabel}>Change Amount</p>
            <p style={{ ...S.infoValue, fontFamily: FONT.mono, color: order.changeAmountCents >= 0 ? COLORS.green : COLORS.red }}>
              {order.changeAmountCents >= 0 ? '+' : ''}${(order.changeAmountCents / 100).toFixed(2)}
            </p>
          </div>
          <div>
            <p style={S.infoLabel}>New Total</p>
            <p style={{ ...S.infoValue, fontFamily: FONT.mono, fontWeight: 700 }}>${(order.newTotalCents / 100).toFixed(2)}</p>
          </div>
          {order.reason && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={S.infoLabel}>Reason</p>
              <p style={{ ...S.infoValue, color: COLORS.textSecondary, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{order.reason}</p>
            </div>
          )}
        </div>
      </div>

      {lines.length > 0 && (
        <div style={S.card}>
          <h2 style={S.sectionTitle}>Line Items</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Action</th>
                  <th style={S.th}>Code</th>
                  <th style={S.th}>Description</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Unit Price</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((li) => (
                  <tr key={li.id}>
                    <td style={{ ...S.td }}>
                      <span style={{
                        display: 'inline-block', padding: '1px 6px', borderRadius: '3px',
                        fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                        background: `${ACTION_COLORS[li.action] ?? '#64748b'}20`,
                        color: ACTION_COLORS[li.action] ?? '#64748b',
                      }}>
                        {li.action}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontFamily: FONT.mono, fontWeight: 600, color: COLORS.amber }}>
                      {li.itemCode}
                    </td>
                    <td style={S.td}>
                      {li.description}
                      {!li.taxable && <span style={muted}> (non-taxable)</span>}
                    </td>
                    <td style={{ ...S.td, ...S.price }}>{(li.quantityHundredths / 100).toFixed(2)}</td>
                    <td style={{ ...S.td, ...S.price }}>${(li.unitPriceCents / 100).toFixed(2)}</td>
                    <td style={{ ...S.td, ...S.price, fontWeight: 600, color: li.action === 'remove' ? COLORS.red : COLORS.green }}>
                      {li.action === 'remove' ? '-' : '+'}${(li.lineTotalCents / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {order.notes && (
        <div style={S.card}>
          <h2 style={S.sectionTitle}>Notes</h2>
          <p style={{ color: COLORS.textSecondary, fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{order.notes}</p>
        </div>
      )}

      {order.rejectionReason && (
        <div style={{ ...S.card, borderColor: COLORS.red }}>
          <h2 style={{ ...S.sectionTitle, color: COLORS.red }}>Rejection Reason</h2>
          <p style={{ color: COLORS.textSecondary, fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{order.rejectionReason}</p>
        </div>
      )}

      <div style={S.card}>
        <h2 style={S.sectionTitle}>Record</h2>
        <div style={S.infoGrid}>
          <div>
            <p style={S.infoLabel}>Created</p>
            <p style={{ ...S.infoValue, color: COLORS.textDim }}>{new Date(order.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p style={S.infoLabel}>Updated</p>
            <p style={{ ...S.infoValue, color: COLORS.textDim }}>{new Date(order.updatedAt).toLocaleString()}</p>
          </div>
          {order.approvedAt && (
            <div>
              <p style={S.infoLabel}>Approved</p>
              <p style={{ ...S.infoValue, color: COLORS.green }}>{new Date(order.approvedAt).toLocaleString()}</p>
            </div>
          )}
          {order.rejectedAt && (
            <div>
              <p style={S.infoLabel}>Rejected</p>
              <p style={{ ...S.infoValue, color: COLORS.red }}>{new Date(order.rejectedAt).toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
