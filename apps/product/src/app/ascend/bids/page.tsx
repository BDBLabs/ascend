import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { formatCents } from '@/lib/tenant';
import { listEstimates } from '@/lib/estimates';
import { listModernizationProjects } from '@/lib/ascend/modernization-projects';
import { getEstimateProjectMap } from '@/lib/ascend/estimate-links';
import { LinkEstimateForm } from '../_forms/links';
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
  draft: A.textDim,
  signed: A.green,
  declined: A.red,
};

/**
 * Bid pipeline. Estimates are the bidding instrument; the
 * estimate↔project linkage lands in a later phase, so each bid links
 * out to its Field estimate for now.
 */
export default async function AscendBidsPage() {
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Bids</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const { estimates, projects, links } = await withFieldContext(
    principal,
    async () => {
      const estimates = await listEstimates();
      const [projects, links] = await Promise.all([
        listModernizationProjects({ limit: 100 }),
        getEstimateProjectMap(estimates.map((e) => e.id)),
      ]);
      return { estimates, projects, links };
    },
  );

  return (
    <div style={page}>
      <h1 style={heading}>Bids</h1>
      <p style={subtitle}>
        Estimates in flight — the front of the modernization pipeline.
      </p>

      {estimates.length === 0 ? (
        <p style={muted}>No bids yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Bid</th>
                <th style={th}>Customer</th>
                <th style={th}>Title</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={th}>Project</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((e) => (
                <tr key={e.id}>
                  <td style={td}>
                    <Link href={`/field/estimates/${e.id}`} style={link}>
                      {e.displayId}
                    </Link>
                  </td>
                  <td style={td}>{e.customerName}</td>
                  <td style={td}>{e.title}</td>
                  <td style={td}>
                    <span style={pill(STATUS_COLORS[e.status] ?? A.textDim)}>
                      {e.status}
                    </span>
                  </td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(e.totals.totalCents)}
                  </td>
                  <td style={td}>
                    {(() => {
                      const linked = links.get(e.id);
                      if (linked) {
                        return (
                          <Link
                            href={`/ascend/projects/${linked.projectId}`}
                            style={link}
                          >
                            {linked.projectDisplayId}
                          </Link>
                        );
                      }
                      if (e.status !== 'signed') return '—';
                      const candidates = projects.filter(
                        (p) =>
                          p.customerId === e.customerId && !p.estimateId,
                      );
                      return (
                        <LinkEstimateForm
                          estimateId={e.id}
                          projects={candidates}
                        />
                      );
                    })()}
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
