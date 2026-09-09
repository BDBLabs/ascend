import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { formatCents } from '@/lib/tenant';
import { listModernizationProjects } from '@/lib/ascend/modernization-projects';
import {
  A,
  card,
  heading,
  link,
  muted,
  page,
  pill,
  subtitle,
  table,
  td,
  th,
  money,
} from '../ascend-theme';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
  prospect: A.textDim,
  bidding: A.blue,
  awarded: A.blue,
  in_progress: A.amber,
  substantially_complete: A.green,
  closed: A.green,
  cancelled: A.red,
};

export default async function AscendProjectsPage() {
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Projects</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const projects = await withFieldContext(principal, async () =>
    listModernizationProjects({ limit: 100 }),
  );

  return (
    <div style={page}>
      <h1 style={heading}>Modernization Projects</h1>
      <p style={subtitle}>
        One project spans one or more elevator units, tracked through work
        packages, costs, progress, and billing.
      </p>

      {projects.length === 0 ? (
        <p style={muted}>No projects yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Project</th>
                <th style={th}>Customer</th>
                <th style={th}>Building</th>
                <th style={th}>Status</th>
                <th style={th}>Manager</th>
                <th style={{ ...th, textAlign: 'right' }}>Contract</th>
                <th style={th}>Units</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td style={td}>
                    <Link href={`/ascend/projects/${p.id}`} style={link}>
                      {p.displayId}
                    </Link>
                  </td>
                  <td style={td}>{p.customerName}</td>
                  <td style={td}>{p.buildingName ?? '—'}</td>
                  <td style={td}>
                    <span style={pill(STATUS_COLORS[p.status] ?? A.textDim)}>
                      {p.status.replaceAll('_', ' ')}
                    </span>
                  </td>
                  <td style={td}>{p.projectManager || '—'}</td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(p.contractValueCents)}
                  </td>
                  <td style={{ ...td, ...money }}>
                    {p.elevatorUnitIds.length}
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
