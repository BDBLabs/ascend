import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getElevatorUnit } from '@/lib/ascend/elevator-units';
import { getBuilding } from '@/lib/ascend/buildings';
import {
  card,
  cardTitle,
  grid,
  heading,
  link,
  page,
  subtitle,
} from '../../ascend-theme';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div style={card}>
      <p style={cardTitle}>{label}</p>
      <p style={{ margin: 0, fontSize: '14px' }}>{value}</p>
    </div>
  );
}

export default async function AscendElevatorDetailPage({ params }: PageProps) {
  const { id } = await params;
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Elevator</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const data = await withFieldContext(principal, async () => {
    const unit = await getElevatorUnit(id);
    if (!unit) return null;
    const building = await getBuilding(unit.buildingId);
    return { unit, building };
  });

  if (!data) notFound();
  const { unit, building } = data;

  return (
    <div style={page}>
      <p style={subtitle}>
        <Link href="/ascend/elevators" style={link}>
          ← Elevators
        </Link>
      </p>
      <h1 style={heading}>Unit {unit.unitNumber}</h1>
      <p style={subtitle}>
        {building ? (
          <Link href={`/ascend/buildings/${building.id}`} style={link}>
            {building.name}
          </Link>
        ) : (
          'Building record unavailable'
        )}
        {unit.elevatorNumber ? ` · Car ${unit.elevatorNumber}` : ''}
      </p>

      <div style={grid}>
        <Spec
          label="Equipment"
          value={[unit.manufacturer, unit.model].filter(Boolean).join(' ') || '—'}
        />
        <Spec label="Serial" value={unit.serialNumber || '—'} />
        <Spec label="Type" value={unit.elevatorType || '—'} />
        <Spec
          label="Rated load"
          value={unit.ratedLoadLbs ? `${unit.ratedLoadLbs.toLocaleString()} lbs` : '—'}
        />
        <Spec
          label="Rated speed"
          value={unit.ratedSpeedFpm ? `${unit.ratedSpeedFpm.toLocaleString()} fpm` : '—'}
        />
        <Spec label="Stops" value={unit.stops !== null ? String(unit.stops) : '—'} />
        <Spec label="Floors served" value={unit.floorsServed || '—'} />
        <Spec
          label="Controller"
          value={[unit.controllerManufacturer, unit.controllerModel]
            .filter(Boolean)
            .join(' ') || '—'}
        />
        <Spec
          label="Drive"
          value={[unit.driveManufacturer, unit.driveModel]
            .filter(Boolean)
            .join(' ') || '—'}
        />
        <Spec
          label="Door operator"
          value={[unit.doorOperatorManufacturer, unit.doorOperatorModel]
            .filter(Boolean)
            .join(' ') || '—'}
        />
      </div>

      <div style={card}>
        <p style={cardTitle}>Existing condition</p>
        <p style={{ margin: 0, fontSize: '14px', whiteSpace: 'pre-wrap' }}>
          {unit.existingCondition || '—'}
        </p>
      </div>
      {unit.notes ? (
        <div style={{ ...card, marginTop: '12px' }}>
          <p style={cardTitle}>Notes</p>
          <p style={{ margin: 0, fontSize: '14px', whiteSpace: 'pre-wrap' }}>
            {unit.notes}
          </p>
        </div>
      ) : null}
    </div>
  );
}
