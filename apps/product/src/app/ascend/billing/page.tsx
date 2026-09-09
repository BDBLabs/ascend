import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { formatCents } from '@/lib/tenant';
import { listModernizationProjects } from '@/lib/ascend/modernization-projects';
import { listApplications } from '@/lib/ascend/progress-billing';
import {
  A,
  card,
  heading,
  link,
  muted,
  page,
  pill,
  subtitle,
  sectionTitle,
  table,
  td,
  th,
  money,
} from '../ascend-theme';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
  draft: A.textDim,
  submitted: A.blue,
  approved: A.green,
  rejected: A.red,
  invoiced: A.green,
};

export default async function AscendBillingPage() {
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Billing</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const projects = await withFieldContext(principal, async () =>
    listModernizationProjects({ limit: 20 }),
  );
  const applicationGroups = await withFieldContext(principal, async () =>
    Promise.all(projects.map((p) => listApplications(p.id))),
  );

  const billed = applicationGroups
    .flat()
    .filter((a) => a.status === 'approved' || a.status === 'invoiced')
    .reduce((sum, a) => sum + a.currentDueCents, 0);

  return (
    <div style={page}>
      <h1 style={heading}>Progress Billing</h1>
      <p style={subtitle}>
        Applications for payment — {formatCents(billed)} approved or invoiced
        to date.
      </p>

      {projects.length === 0 ? (
        <p style={muted}>No projects yet.</p>
      ) : (
        projects.map((p, i) => (
          <div key={p.id}>
            <h2 style={sectionTitle}>
              <Link href={`/ascend/projects/${p.id}`} style={link}>
                {p.displayId}
              </Link>{' '}
              <span style={{ ...muted, fontWeight: 400 }}>{p.customerName}</span>
            </h2>
            {applicationGroups[i].length === 0 ? (
              <p style={muted}>No applications.</p>
            ) : (
              <div style={card}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>App</th>
                      <th style={th}>Status</th>
                      <th style={{ ...th, textAlign: 'right' }}>Earned</th>
                      <th style={{ ...th, textAlign: 'right' }}>Prev. billed</th>
                      <th style={{ ...th, textAlign: 'right' }}>Retainage</th>
                      <th style={{ ...th, textAlign: 'right' }}>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applicationGroups[i].map((a) => (
                      <tr key={a.id}>
                        <td style={td}>#{a.periodNumber}</td>
                        <td style={td}>
                          <span style={pill(STATUS_COLORS[a.status] ?? A.textDim)}>
                            {a.status}
                          </span>
                        </td>
                        <td style={{ ...td, ...money }}>
                          {formatCents(a.earnedValueCents)}
                        </td>
                        <td style={{ ...td, ...money }}>
                          {formatCents(a.previouslyBilledCents)}
                        </td>
                        <td style={{ ...td, ...money }}>
                          {formatCents(a.retainageCents)}
                        </td>
                        <td style={{ ...td, ...money }}>
                          {formatCents(a.currentDueCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
