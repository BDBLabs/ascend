import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listProjectParts } from '@/lib/ascend/project-parts';
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
  specified: A.textDim,
  ordered: A.blue,
  shipped: A.blue,
  received: A.amber,
  allocated: A.amber,
  installed: A.green,
  returned: A.red,
  cancelled: A.red,
};

export default async function AscendPartsPage() {
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Parts</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const parts = await withFieldContext(principal, async () =>
    listProjectParts({ limit: 100 }),
  );

  return (
    <div style={page}>
      <h1 style={heading}>Procurement & Parts</h1>
      <p style={subtitle}>
        Specified → ordered → received → installed across all projects.
      </p>

      {parts.length === 0 ? (
        <p style={muted}>No parts specified yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Part</th>
                <th style={th}>Project</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Req.</th>
                <th style={{ ...th, textAlign: 'right' }}>Rec.</th>
                <th style={{ ...th, textAlign: 'right' }}>Inst.</th>
                <th style={th}>Supplier</th>
                <th style={th}>Needed</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id}>
                  <td style={td}>{p.description}</td>
                  <td style={td}>
                    <Link href={`/ascend/projects/${p.projectId}`} style={link}>
                      {p.projectDisplayId}
                    </Link>
                  </td>
                  <td style={td}>
                    <span style={pill(STATUS_COLORS[p.status] ?? A.textDim)}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ ...td, ...money }}>
                    {(p.quantityRequiredHundredths / 100).toLocaleString()}
                  </td>
                  <td style={{ ...td, ...money }}>
                    {(p.quantityReceivedHundredths / 100).toLocaleString()}
                  </td>
                  <td style={{ ...td, ...money }}>
                    {(p.quantityInstalledHundredths / 100).toLocaleString()}
                  </td>
                  <td style={td}>{p.supplier || '—'}</td>
                  <td style={td}>{p.neededDate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
