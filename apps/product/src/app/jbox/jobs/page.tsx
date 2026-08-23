import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listJobs } from '@/lib/jobs';
import type { JobRecord } from '@/lib/job-record';

export const dynamic = 'force-dynamic';

const S = {
  heading: { fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase', color: 'white', margin: '0 0 8px' } as const,
  subtitle: { color: '#94a3b8', fontSize: '0.875rem', margin: 0 } as const,
  card: { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '32px' } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' } as const,
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #334155', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' } as const,
  td: { padding: '10px 12px', borderBottom: '1px solid #1e293b', color: '#cbd5e1' } as const,
  muted: { color: '#64748b', fontSize: '0.8125rem' } as const,
  badge: (bg: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: bg, color: '#0f172a' }) as const,
};

const STATUS_BG: Record<string, string> = {
  scheduled: '#3b82f6',
  in_progress: '#f59e0b',
  completed: '#10b981',
  cancelled: '#ef4444',
};

export default async function JBoxJobsPage() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'jobs.read')) {
    return (
      <div style={{ padding: '2rem', color: '#ef4444', fontSize: '0.875rem' }}>
        Your staff role does not include access to work orders.
      </div>
    );
  }

  if (!isDatabaseConfigured()) {
    return (
      <div>
        <h1 style={S.heading}>Work Orders</h1>
        <p style={S.subtitle}>Active jobs, crew assignments, and completion tracking.</p>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '32px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Database not configured
          </p>
        </div>
      </div>
    );
  }

  let jobs: JobRecord[] = [];
  try {
    jobs = await withFieldContext(principal, () => listJobs({}));
  } catch {
    jobs = [];
  }

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={S.heading}>Work Orders</h1>
        <p style={S.subtitle}>Active jobs, crew assignments, and completion tracking.</p>
      </div>

      {jobs.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No jobs yet.
          </p>
        </div>
      ) : (
        <div style={S.card}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Job</th>
                <th style={S.th}>Customer</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td style={S.td}>
                    <span style={{ fontWeight: 600 }}>{job.displayId}</span>
                    {job.title && <div style={S.muted}>{job.title}</div>}
                  </td>
                  <td style={S.td}>{job.customerName}</td>
                  <td style={S.td}>
                    <span style={S.badge(STATUS_BG[job.status] ?? '#64748b')}>{job.status}</span>
                  </td>
                  <td style={{ ...S.td, ...S.muted }}>
                    {new Date(job.createdAt).toLocaleDateString()}
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
