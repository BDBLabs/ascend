import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getBuilding } from '@/lib/ascend/buildings';
import { listElevatorUnits } from '@/lib/ascend/elevator-units';
import { listModernizationProjects } from '@/lib/ascend/modernization-projects';
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
  sectionTitle,
} from '../../ascend-theme';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

export default async function AscendBuildingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Building</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const data = await withFieldContext(principal, async () => {
    const building = await getBuilding(id);
    if (!building) return null;
    const [units, projects] = await Promise.all([
      listElevatorUnits({ buildingId: id, limit: 100 }),
      listModernizationProjects({ buildingId: id, limit: 100 }),
    ]);
    return { building, units, projects };
  });

  if (!data) notFound();
  const { building, units, projects } = data;

  return (
    <div style={page}>
      <p style={subtitle}>
        <Link href="/ascend/buildings" style={link}>
          ← Buildings
        </Link>
      </p>
      <h1 style={heading}>{building.name}</h1>
      <p style={subtitle}>
        {building.customerName}
        {[building.address, building.city, building.state, building.postalCode]
          .filter(Boolean)
          .join(', ') || ' · no address on file'}
      </p>

      <div style={card}>
        <p style={muted}>
          Contact: {building.primaryContact || '—'}
          {building.contactPhone ? ` · ${building.contactPhone}` : ''}
          {building.contactEmail ? ` · ${building.contactEmail}` : ''}
          {building.notes ? ` · ${building.notes}` : ''}
        </p>
      </div>

      <h2 style={sectionTitle}>Elevator units ({units.length})</h2>
      {units.length === 0 ? (
        <p style={muted}>No units recorded for this building.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Unit</th>
                <th style={th}>Make / model</th>
                <th style={th}>Type</th>
                <th style={th}>Stops</th>
                <th style={th}>Condition</th>
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
                  <td style={td}>
                    {[u.manufacturer, u.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td style={td}>{u.elevatorType || '—'}</td>
                  <td style={{ ...td, ...money }}>{u.stops ?? '—'}</td>
                  <td style={td}>
                    {u.existingCondition
                      ? `${u.existingCondition.slice(0, 80)}${u.existingCondition.length > 80 ? '…' : ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={sectionTitle}>Projects at this building ({projects.length})</h2>
      {projects.length === 0 ? (
        <p style={muted}>No projects at this building.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Project</th>
                <th style={th}>Status</th>
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
                  <td style={td}>{p.status.replaceAll('_', ' ')}</td>
                  <td style={{ ...td, ...money }}>{p.elevatorUnitIds.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
