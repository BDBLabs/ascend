import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listElevatorUnits } from '@/lib/ascend/elevator-units';
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
  money,
} from '../ascend-theme';

export const dynamic = 'force-dynamic';

export default async function AscendElevatorsPage() {
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Elevators</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const units = await withFieldContext(principal, async () =>
    listElevatorUnits({ limit: 100 }),
  );

  return (
    <div style={page}>
      <h1 style={heading}>Elevator Units</h1>
      <p style={subtitle}>
        Every car under modernization — survey data, equipment, condition.
      </p>

      {units.length === 0 ? (
        <p style={muted}>No elevator units yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Unit</th>
                <th style={th}>Building</th>
                <th style={th}>Make / model</th>
                <th style={th}>Type</th>
                <th style={th}>Stops</th>
                <th style={th}>Drive</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td style={td}>
                    <Link href={`/ascend/elevators/${u.id}`} style={link}>
                      {u.unitNumber}
                    </Link>
                  </td>
                  <td style={td}>{u.buildingName}</td>
                  <td style={td}>
                    {[u.manufacturer, u.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td style={td}>{u.elevatorType || '—'}</td>
                  <td style={{ ...td, ...money }}>{u.stops ?? '—'}</td>
                  <td style={td}>
                    {[u.driveManufacturer, u.driveModel]
                      .filter(Boolean)
                      .join(' ') || '—'}
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
