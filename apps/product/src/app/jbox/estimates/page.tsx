import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listEstimates } from '@/lib/estimates';

export const dynamic = 'force-dynamic';

const S = {
  heading: { fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase', color: 'white', margin: '0 0 8px' } as const,
  subtitle: { color: '#94a3b8', fontSize: '0.875rem', margin: 0 } as const,
  card: { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '32px' } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' } as const,
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #334155', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' } as const,
  td: { padding: '10px 12px', borderBottom: '1px solid #1e293b', color: '#cbd5e1' } as const,
  muted: { color: '#64748b', fontSize: '0.8125rem' } as const,
  link: { color: '#f59e0b', textDecoration: 'none', fontWeight: 600 } as const,
  badge: (bg: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: bg, color: '#0f172a' }) as const,
};

const STATUS_BG: Record<string, string> = {
  draft: '#64748b',
  signed: '#10b981',
  declined: '#ef4444',
};

export default async function JBoxEstimatesPage() {
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
        <h1 style={S.heading}>Bids &amp; Takeoffs</h1>
        <p style={S.subtitle}>Build estimates with takeoff sketching and scope binding.</p>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '32px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Database not configured
          </p>
        </div>
      </div>
    );
  }

  const estimates = await withFieldContext(principal, () => listEstimates());

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={S.heading}>Bids &amp; Takeoffs</h1>
        <p style={S.subtitle}>Build estimates with takeoff sketching and scope binding.</p>
      </div>

      {estimates.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No estimates yet.
          </p>
        </div>
      ) : (
        <div style={S.card}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Estimate</th>
                <th style={S.th}>Customer</th>
                <th style={S.th}>Status</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Total</th>
                <th style={S.th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((estimate) => (
                <tr key={estimate.id}>
                  <td style={S.td}>
                    <a href={`/jbox/estimates/${estimate.id}`} style={S.link}>{estimate.displayId}</a>
                    {estimate.title && <div style={S.muted}>{estimate.title}</div>}
                  </td>
                  <td style={S.td}>{estimate.customerName}</td>
                  <td style={S.td}>
                    <span style={S.badge(STATUS_BG[estimate.status] ?? '#64748b')}>{estimate.status}</span>
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                    ${(estimate.totals.totalCents / 100).toFixed(2)}
                  </td>
                  <td style={{ ...S.td, ...S.muted }}>
                    {new Date(estimate.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
