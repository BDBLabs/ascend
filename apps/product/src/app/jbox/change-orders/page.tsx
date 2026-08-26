import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listChangeOrders, type ChangeOrderSummary } from '@/lib/change-orders';
import {
  COLORS,
  FONT,
  STATUS_BG,
  STATUS_LABELS,
  card,
  heading,
  muted,
  statusBadge,
  subtitle,
  table,
  td,
  th,
} from '../jbox-tokens';

export const dynamic = 'force-dynamic';

const S = {
  card: { ...card, padding: '24px' },
  heading: { ...heading, margin: '8px 0 0' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${COLORS.border}` },
  code: { fontFamily: FONT.mono, color: COLORS.amber, fontWeight: 600, fontSize: '0.875rem' },
  title: { color: COLORS.textSecondary, fontSize: '0.875rem', flex: 1, margin: '0 16px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  amount: { fontFamily: FONT.mono, fontSize: '0.875rem', color: COLORS.textMuted, marginRight: '16px' },
  empty: { color: COLORS.textDim, fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 700 },
};

export default async function JBoxChangeOrdersPage() {
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
      <div style={S.card}>
        <p style={S.empty}>Database not configured</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={S.heading}>Change Orders</h1>
        <p style={subtitle}>All change orders across estimates.</p>
      </div>

      <div style={S.card}>
        <p style={{ color: COLORS.textDim, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
          Change orders are created from estimate detail pages. Select an estimate to manage its change orders.
        </p>
      </div>
    </div>
  );
}
