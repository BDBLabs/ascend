import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listJobs } from '@/lib/jobs';
import type { JobRecord } from '@/lib/job-record';
import {
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
        <h1 style={heading}>Work Orders</h1>
        <p style={subtitle}>Active jobs, crew assignments, and completion tracking.</p>
        <div style={{ ...card, textAlign: 'center', marginTop: '32px' }}>
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
        <h1 style={heading}>Work Orders</h1>
        <p style={subtitle}>Active jobs, crew assignments, and completion tracking.</p>
      </div>

      {jobs.length === 0 ? (
        <div style={{ ...card, textAlign: 'center' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No jobs yet.
          </p>
        </div>
      ) : (
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Job</th>
                <th style={th}>Customer</th>
                <th style={th}>Status</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td style={td}>
                    <a href={`/jbox/jobs/${job.id}`} style={{ color: '#f59e0b', textDecoration: 'none', fontWeight: 600 }}>{job.displayId}</a>
                    {job.title && <div style={muted}>{job.title}</div>}
                  </td>
                  <td style={td}>{job.customerName}</td>
                  <td style={td}>
                    <span style={statusBadge(job.status)}>{job.status}</span>
                  </td>
                  <td style={{ ...td, ...muted }}>
                    {new Date(job.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
