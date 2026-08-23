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

export const dynamic = 'force-dynamic';

const S = {
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' } as const,
  stat: (color: string) => ({ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px' }) as const,
  statLabel: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', marginBottom: '8px' } as const,
  statValue: (color: string) => ({ fontSize: '1.75rem', fontWeight: 900, color, fontFamily: 'ui-monospace, monospace' }) as const,
  subtitle: { color: '#94a3b8', fontSize: '0.875rem', margin: 0 } as const,
  heading: { fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase', color: 'white', margin: '0 0 8px' } as const,
  sectionTitle: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', margin: '32px 0 16px' } as const,
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
  scheduled: '#3b82f6',
  in_progress: '#f59e0b',
  completed: '#10b981',
  cancelled: '#ef4444',
  draft_invoice: '#64748b',
  issued: '#3b82f6',
  paid: '#10b981',
};

export default async function JBoxDashboardPage() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return (
      <div style={{ padding: '2rem', color: '#ef4444', fontSize: '0.875rem' }}>
        Your staff role does not include access to this workspace.
      </div>
    );
  }

  if (!isDatabaseConfigured()) {
    return (
      <div>
        <h1 style={S.heading}>Shop Control</h1>
        <p style={S.subtitle}>Active work orders, crew status, and dispatch queue.</p>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '32px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
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
        <h1 style={S.heading}>Shop Control</h1>
        <p style={S.subtitle}>Active work orders, crew status, and dispatch queue.</p>
      </div>

      <div style={S.statGrid}>
        <div style={S.stat('#f59e0b')}>
          <div style={S.statLabel}>Active Jobs</div>
          <div style={S.statValue('#f59e0b')}>{activeJobs.length}</div>
        </div>
        <div style={S.stat('#3b82f6')}>
          <div style={S.statLabel}>Pending Bids</div>
          <div style={S.statValue('#3b82f6')}>{draftEstimates.length}</div>
        </div>
        <div style={S.stat('#ef4444')}>
          <div style={S.statLabel}>Open Invoices</div>
          <div style={S.statValue('#ef4444')}>{openInvoices.length}</div>
        </div>
        <div style={S.stat('#10b981')}>
          <div style={S.statLabel}>Clients</div>
          <div style={S.statValue('#10b981')}>{customers.length}</div>
        </div>
      </div>

      {recentEstimates.length > 0 && (
        <>
          <h2 style={S.sectionTitle}>Recent Bids</h2>
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
                {recentEstimates.map((e) => (
                  <tr key={e.id}>
                    <td style={S.td}>
                      <a href={`/jbox/estimates/${e.id}`} style={S.link}>{e.displayId}</a>
                      {e.title && <div style={S.muted}>{e.title}</div>}
                    </td>
                    <td style={S.td}>{e.customerName}</td>
                    <td style={S.td}>
                      <span style={S.badge(STATUS_BG[e.status] ?? '#64748b')}>{e.status}</span>
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                      ${(e.totals.totalCents / 100).toFixed(2)}
                    </td>
                    <td style={{ ...S.td, ...S.muted }}>
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
        <div style={{ ...S.card, textAlign: 'center' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No active data yet — create your first estimate to get started
          </p>
        </div>
      )}
    </div>
  );
}
