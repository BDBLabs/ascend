import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listEstimates } from '@/lib/estimates';
import {
  card,
  heading,
  link,
  muted,
  statusBadge,
  subtitle,
  table,
  td,
  th,
} from '../jbox-tokens';

export const dynamic = 'force-dynamic';

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
        <h1 style={heading}>Bids &amp; Takeoffs</h1>
        <p style={subtitle}>Build estimates with takeoff sketching and scope binding.</p>
        <div style={{ ...card, textAlign: 'center', marginTop: '32px' }}>
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
        <h1 style={heading}>Bids &amp; Takeoffs</h1>
        <p style={subtitle}>Build estimates with takeoff sketching and scope binding.</p>
      </div>

      {estimates.length === 0 ? (
        <div style={{ ...card, textAlign: 'center' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No estimates yet.
          </p>
        </div>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Estimate</th>
                <th style={th}>Customer</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((estimate) => (
                <tr key={estimate.id}>
                  <td style={td}>
                    <a href={`/jbox/estimates/${estimate.id}`} style={link}>{estimate.displayId}</a>
                    {estimate.title && <div style={muted}>{estimate.title}</div>}
                  </td>
                  <td style={td}>{estimate.customerName}</td>
                  <td style={td}>
                    <span style={statusBadge(estimate.status)}>{estimate.status}</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                    ${(estimate.totals.totalCents / 100).toFixed(2)}
                  </td>
                  <td style={{ ...td, ...muted }}>
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
