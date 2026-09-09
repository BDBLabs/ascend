import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listBuildings } from '@/lib/ascend/buildings';
import {
  card,
  heading,
  link,
  muted,
  page,
  subtitle,
  table,
  td,
  th,
} from '../ascend-theme';

export const dynamic = 'force-dynamic';

export default async function AscendBuildingsPage() {
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Buildings</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const buildings = await withFieldContext(principal, async () =>
    listBuildings({ limit: 100 }),
  );

  return (
    <div style={page}>
      <h1 style={heading}>Buildings & Sites</h1>
      <p style={subtitle}>
        Customer sites where elevator units live and modernization happens.
      </p>

      {buildings.length === 0 ? (
        <p style={muted}>No buildings yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Building</th>
                <th style={th}>Customer</th>
                <th style={th}>City</th>
                <th style={th}>Contact</th>
                <th style={th}>Phone</th>
              </tr>
            </thead>
            <tbody>
              {buildings.map((b) => (
                <tr key={b.id}>
                  <td style={td}>
                    <Link href={`/ascend/buildings/${b.id}`} style={link}>
                      {b.name}
                    </Link>
                  </td>
                  <td style={td}>{b.customerName}</td>
                  <td style={td}>
                    {[b.city, b.state].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td style={td}>{b.primaryContact || '—'}</td>
                  <td style={td}>{b.contactPhone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
