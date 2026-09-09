import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { formatCents } from '@/lib/tenant';
import { listModernizationProjects } from '@/lib/ascend/modernization-projects';
import { getProjectProgress } from '@/lib/ascend/project-progress';
import {
  A,
  bigNumber,
  card,
  cardTitle,
  grid,
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
} from './ascend-theme';

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

/**
 * Portfolio dashboard. Per-project progress is fanned out one report at
 * a time — fine at prototype scale; a single aggregate query replaces
 * this when the portfolio grows.
 */
export default async function AscendDashboardPage() {
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Ascend Dashboard</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const projects = await withFieldContext(principal, async () =>
    listModernizationProjects({ limit: 50 }),
  );
  const reports = await withFieldContext(principal, async () =>
    Promise.all(projects.map((p) => getProjectProgress(p.id))),
  );

  const totals = reports.reduce(
    (acc, r) => {
      if (!r) return acc;
      acc.contract += r.contractValueCents;
      acc.earned += r.earnedValueCents;
      acc.actual += r.actualCostCents;
      acc.forecast += r.forecastFinalCents;
      acc.billed += r.billedToDateCents;
      return acc;
    },
    { contract: 0, earned: 0, actual: 0, forecast: 0, billed: 0 },
  );
  const margin = totals.contract - totals.forecast;

  return (
    <div style={page}>
      <h1 style={heading}>Ascend Dashboard</h1>
      <p style={subtitle}>
        Elevator modernization portfolio — execution, cost, progress, billing.
      </p>

      <div style={grid}>
        <div style={card}>
          <p style={cardTitle}>Projects</p>
          <p style={bigNumber}>{projects.length}</p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Contract value</p>
          <p style={bigNumber}>{formatCents(totals.contract)}</p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Earned value</p>
          <p style={bigNumber}>{formatCents(totals.earned)}</p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Actual cost</p>
          <p style={bigNumber}>{formatCents(totals.actual)}</p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Forecast final</p>
          <p style={bigNumber}>{formatCents(totals.forecast)}</p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Projected margin</p>
          <p style={{ ...bigNumber, color: margin >= 0 ? A.green : A.red }}>
            {formatCents(margin)}
          </p>
        </div>
      </div>

      {projects.length === 0 ? (
        <p style={muted}>
          No modernization projects yet. Projects, buildings, and elevators
          are created through the Ascend API; list and detail views will
          appear here.
        </p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Project</th>
                <th style={th}>Customer</th>
                <th style={th}>Building</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Contract</th>
                <th style={{ ...th, textAlign: 'right' }}>Earned</th>
                <th style={{ ...th, textAlign: 'right' }}>Progress</th>
                <th style={{ ...th, textAlign: 'right' }}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => {
                const r = reports[i];
                return (
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
                    <td style={{ ...td, ...money }}>
                      {formatCents(p.contractValueCents)}
                    </td>
                    <td style={{ ...td, ...money }}>
                      {r ? formatCents(r.earnedValueCents) : '—'}
                    </td>
                    <td style={{ ...td, ...money }}>
                      {r ? `${r.overallPercentComplete}%` : '—'}
                    </td>
                    <td style={{ ...td, ...money }}>
                      {r ? formatCents(r.projectedMarginCents) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
