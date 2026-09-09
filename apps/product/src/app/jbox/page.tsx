import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listEstimates } from '@/lib/estimates';
import { listCustomers } from '@/lib/customers';
import { listJobs } from '@/lib/jobs';
import { listInvoices } from '@/lib/invoices';
import { COLORS, FONT, card, heading, subtitle, muted, link, table, th, td, statusBadge } from './jbox-tokens';

export const dynamic = 'force-dynamic';

const S = {
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' } as const,
  stat: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '20px' } as const,
  statLabel: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.textDim, marginBottom: '8px' } as const,
  sectionTitle: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.textDim, margin: '32px 0 16px' } as const,
  price: { fontFamily: FONT.mono, textAlign: 'right' as const, fontWeight: 600 },
};

export default async function JBoxDashboardPage() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return (
      <div style={{ padding: '2rem', color: COLORS.red, fontSize: '0.875rem' }}>
        Your staff role does not include access to this workspace.
      </div>
    );
  }

  if (!isDatabaseConfigured()) {
    return (
      <div>
        <h1 style={heading}>Shop Control</h1>
        <p style={subtitle}>Active work orders, crew status, and dispatch queue.</p>
        <div style={{ ...card, textAlign: 'center', marginTop: '32px' }}>
          <p style={{ color: COLORS.textDimmer, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Database not configured
          </p>
        </div>
      </div>
    );
  }

  const { estimates, customers, jobs, invoices } = await withFieldContext(principal, async () => {
    const [estimates, customers, jobs, invoices] = await Promise.all([
      listEstimates(),
      listCustomers(''),
      listJobs({}),
      listInvoices({}),
    ]);
    return { estimates, customers, jobs, invoices };
  });

  const draftEstimates = estimates.filter((e) => e.status === 'draft');
  const activeJobs = jobs.filter((j) => j.status === 'scheduled' || j.status === 'in_progress');
  const openInvoices = invoices.filter((i) => i.status === 'draft' || i.status === 'issued');
  const recentEstimates = estimates.slice(0, 8);

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={heading}>Shop Control</h1>
        <p style={subtitle}>Active work orders, crew status, and dispatch queue.</p>
      </div>

      <div style={S.statGrid}>
        <div style={S.stat}>
          <div style={S.statLabel}>Active Jobs</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900, color: COLORS.amber, fontFamily: FONT.mono }}>{activeJobs.length}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Pending Bids</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900, color: COLORS.blue, fontFamily: FONT.mono }}>{draftEstimates.length}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Open Invoices</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900, color: COLORS.red, fontFamily: FONT.mono }}>{openInvoices.length}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Clients</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900, color: COLORS.green, fontFamily: FONT.mono }}>{customers.length}</div>
        </div>
      </div>

      {recentEstimates.length > 0 && (
        <>
          <h2 style={S.sectionTitle}>Recent Bids</h2>
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
                {recentEstimates.map((e) => (
                  <tr key={e.id}>
                    <td style={td}>
                      <a href={`/jbox/estimates/${e.id}`} style={link}>{e.displayId}</a>
                      {e.title && <div style={muted}>{e.title}</div>}
                    </td>
                    <td style={td}>{e.customerName}</td>
                    <td style={td}>
                      <span style={statusBadge(e.status)}>{e.status}</span>
                    </td>
                    <td style={{ ...td, ...S.price }}>
                      ${(e.totals.totalCents / 100).toFixed(2)}
                    </td>
                    <td style={{ ...td, ...muted }}>
                      {new Date(e.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {recentEstimates.length === 0 && activeJobs.length === 0 && (
        <div style={{ ...card, textAlign: 'center' }}>
          <p style={{ color: COLORS.textDimmer, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No active data yet — create your first estimate to get started
          </p>
        </div>
      )}
    </div>
  );
}
