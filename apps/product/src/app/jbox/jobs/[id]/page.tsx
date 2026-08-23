import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getJob } from '@/lib/jobs';
import {
  COLORS,
  STATUS_LABELS,
  card,
  heading,
  muted,
  statusBadge,
  subtitle,
} from '../../jbox-tokens';

export const dynamic = 'force-dynamic';

const S = {
  backLink: { color: COLORS.textMuted, textDecoration: 'none', fontSize: '0.875rem' } as const,
  heading: { ...heading, margin: '8px 0 0' },
  subtitle: { ...subtitle, marginTop: '4px' },
  card: { ...card, padding: '24px', marginBottom: '20px' },
  sectionTitle: { fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.amber, margin: '0 0 16px' } as const,
  sectionText: { color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 } as const,
  infoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px' } as const,
  infoLabel: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.textDim, margin: '0 0 4px' } as const,
  infoValue: { color: COLORS.textSecondary, fontSize: '0.875rem', margin: 0 } as const,
};

export default async function JBoxJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
        <a href="/jbox/jobs" style={S.backLink}>&larr; All Jobs</a>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '24px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Database not configured
          </p>
        </div>
      </div>
    );
  }

  const job = await withFieldContext(principal, () => getJob(id));

  if (!job) {
    return (
      <div>
        <a href="/jbox/jobs" style={S.backLink}>&larr; All Jobs</a>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '24px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Job not found
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <a href="/jbox/jobs" style={S.backLink}>&larr; All Jobs</a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={S.heading}>{job.displayId}</h1>
          <span style={statusBadge(job.status)}>
            {STATUS_LABELS[job.status] ?? job.status}
          </span>
        </div>
        <p style={S.subtitle}>{job.title}</p>
        {job.customerId ? (
          <p style={muted}>
            Customer:{' '}
            <a href={`/jbox/customers/${job.customerId}`} style={{ ...muted, color: COLORS.amber, textDecoration: 'none', fontWeight: 600 }}>
              {job.customerName}
            </a>
          </p>
        ) : (
          job.customerName && <p style={muted}>Customer: {job.customerName}</p>
        )}
      </div>

      {(job.notes || job.customerStatedProblem || job.technicianDiagnosis) && (
        <>
          {job.notes && (
            <div style={S.card}>
              <h2 style={S.sectionTitle}>Notes</h2>
              <p style={S.sectionText}>{job.notes}</p>
            </div>
          )}
          {job.customerStatedProblem && (
            <div style={S.card}>
              <h2 style={S.sectionTitle}>Customer Stated Problem</h2>
              <p style={S.sectionText}>{job.customerStatedProblem}</p>
            </div>
          )}
          {job.technicianDiagnosis && (
            <div style={S.card}>
              <h2 style={S.sectionTitle}>Technician Diagnosis</h2>
              <p style={S.sectionText}>{job.technicianDiagnosis}</p>
            </div>
          )}
        </>
      )}

      <div style={{ ...S.card }}>
        <h2 style={S.sectionTitle}>Record</h2>
        <div style={S.infoGrid}>
          <div>
            <p style={S.infoLabel}>Created</p>
            <p style={{ ...S.infoValue, ...muted }}>{new Date(job.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p style={S.infoLabel}>Updated</p>
            <p style={{ ...S.infoValue, ...muted }}>{new Date(job.updatedAt).toLocaleString()}</p>
          </div>
          {job.estimateId && (
            <div>
              <p style={S.infoLabel}>Estimate</p>
              <p style={S.infoValue}>
                <a href={`/jbox/estimates/${job.estimateId}`} style={{ color: COLORS.amber, textDecoration: 'none', fontWeight: 600 }}>
                  {job.estimateId.slice(0, 8)}...
                </a>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
