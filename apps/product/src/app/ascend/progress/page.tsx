import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listModernizationProjects } from '@/lib/ascend/modernization-projects';
import { listWorkPackages } from '@/lib/ascend/work-packages';
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
  not_started: A.textDim,
  in_progress: A.amber,
  complete: A.green,
  on_hold: A.blue,
  cancelled: A.red,
};

function ProgressBar({ percent }: { percent: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '120px',
        height: '8px',
        borderRadius: '4px',
        background: A.border,
        verticalAlign: 'middle',
      }}
    >
      <span
        style={{
          display: 'block',
          width: `${Math.min(100, Math.max(0, percent))}%`,
          height: '100%',
          borderRadius: '4px',
          background: A.amber,
        }}
      />
    </span>
  );
}

export default async function AscendProgressPage() {
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Progress</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const projects = await withFieldContext(principal, async () =>
    listModernizationProjects({ limit: 20 }),
  );
  const packageGroups = await withFieldContext(principal, async () =>
    Promise.all(projects.map((p) => listWorkPackages({ projectId: p.id, limit: 100 }))),
  );

  return (
    <div style={page}>
      <h1 style={heading}>Progress</h1>
      <p style={subtitle}>
        Work-package progress across projects — the independently stored
        operational truth behind earned value.
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
            {packageGroups[i].length === 0 ? (
              <p style={muted}>No work packages.</p>
            ) : (
              <div style={card}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Package</th>
                      <th style={th}>Status</th>
                      <th style={th}>Progress</th>
                      <th style={{ ...th, textAlign: 'right' }}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packageGroups[i].map((w) => (
                      <tr key={w.id}>
                        <td style={td}>{w.name}</td>
                        <td style={td}>
                          <span style={pill(STATUS_COLORS[w.status] ?? A.textDim)}>
                            {w.status.replaceAll('_', ' ')}
                          </span>
                        </td>
                        <td style={td}>
                          <ProgressBar percent={w.percentComplete} />
                        </td>
                        <td style={{ ...td, ...money }}>{w.percentComplete}%</td>
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
