import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { formatCents } from '@/lib/tenant';
import { listModernizationProjects } from '@/lib/ascend/modernization-projects';
import { summarizeProjectCosts } from '@/lib/ascend/project-costs';
import {
  bigNumber,
  card,
  cardTitle,
  grid,
  heading,
  link,
  muted,
  page,
  subtitle,
  table,
  td,
  th,
  money,
} from '../ascend-theme';

export const dynamic = 'force-dynamic';

export default async function AscendCostsPage() {
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Costs</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const projects = await withFieldContext(principal, async () =>
    listModernizationProjects({ limit: 20 }),
  );
  const summaries = await withFieldContext(principal, async () =>
    Promise.all(projects.map((p) => summarizeProjectCosts(p.id))),
  );

  const grand = summaries.reduce(
    (acc, s) => {
      for (const key of ['budget', 'actual', 'committed', 'forecast'] as const) {
        acc[key] += s.totalsByKind[key];
      }
      return acc;
    },
    { budget: 0, actual: 0, committed: 0, forecast: 0 },
  );

  return (
    <div style={page}>
      <h1 style={heading}>Costs</h1>
      <p style={subtitle}>
        Budget, actual, committed, and forecast across the portfolio.
      </p>

      <div style={grid}>
        {(
          [
            ['Budget', grand.budget],
            ['Actual', grand.actual],
            ['Committed', grand.committed],
            ['Forecast', grand.forecast],
          ] as const
        ).map(([label, value]) => (
          <div key={label} style={card}>
            <p style={cardTitle}>{label}</p>
            <p style={bigNumber}>{formatCents(value)}</p>
          </div>
        ))}
      </div>

      {projects.length === 0 ? (
        <p style={muted}>No projects yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Project</th>
                <th style={{ ...th, textAlign: 'right' }}>Budget</th>
                <th style={{ ...th, textAlign: 'right' }}>Actual</th>
                <th style={{ ...th, textAlign: 'right' }}>Committed</th>
                <th style={{ ...th, textAlign: 'right' }}>Forecast</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => (
                <tr key={p.id}>
                  <td style={td}>
                    <Link href={`/ascend/projects/${p.id}`} style={link}>
                      {p.displayId}
                    </Link>
                  </td>
                  {(
                    ['budget', 'actual', 'committed', 'forecast'] as const
                  ).map((kind) => (
                    <td key={kind} style={{ ...td, ...money }}>
                      {formatCents(summaries[i].totalsByKind[kind])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
