'use client';

import { useRouter } from 'next/navigation';
import { parseDollarsToCents } from '@/lib/ascend/money-input';
import type {
  ElevatorUnitRecord,
  WorkPackageRecord,
} from '@/lib/ascend/ascend-records';
import {
  Field,
  FormError,
  buttonStyle,
  formBox,
  inputStyle,
  postAscend,
  secondaryButtonStyle,
  useAscendSubmit,
} from './form';

const PACKAGE_CATEGORIES = [
  'Engineering',
  'Procurement',
  'Controller',
  'Drive',
  'Machine',
  'Door Equipment',
  'Cab Fixtures',
  'Hall Fixtures',
  'Traveling Cable',
  'Safety',
  'Electrical',
  'Hydraulic',
  'Installation',
  'Testing',
  'Inspection',
  'Closeout',
  'Other',
];

export function NewPackageForm({ projectId }: { projectId: string }) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    const budget = parseDollarsToCents(String(data.get('budget') ?? ''));
    const sell = parseDollarsToCents(String(data.get('sell') ?? ''));
    if (budget === null || sell === null) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'Invalid budget or sell value.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return postAscend('/api/ascend/packages', {
      projectId,
      name: String(data.get('name') ?? ''),
      category: String(data.get('category') ?? ''),
      description: String(data.get('description') ?? ''),
      budgetCostCents: budget,
      contractValueCents: sell,
      plannedStart: String(data.get('plannedStart') ?? '') || null,
      plannedFinish: String(data.get('plannedFinish') ?? '') || null,
      responsiblePerson: String(data.get('responsiblePerson') ?? ''),
    });
  });

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>New work package</h3>
      <FormError message={error} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Name">
          <input name="name" required minLength={2} maxLength={200} style={inputStyle} />
        </Field>
        <Field label="Category">
          <select name="category" style={inputStyle} defaultValue="Other">
            {PACKAGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Description">
        <input name="description" maxLength={4000} style={inputStyle} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Budget cost ($)">
          <input name="budget" inputMode="decimal" placeholder="0.00" style={inputStyle} />
        </Field>
        <Field label="Sell value ($)">
          <input name="sell" inputMode="decimal" placeholder="0.00" style={inputStyle} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Planned start">
          <input name="plannedStart" type="date" style={inputStyle} />
        </Field>
        <Field label="Planned finish">
          <input name="plannedFinish" type="date" style={inputStyle} />
        </Field>
      </div>
      <Field label="Responsible person">
        <input name="responsiblePerson" maxLength={200} style={inputStyle} />
      </Field>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Saving…' : 'Add package'}
      </button>
    </form>
  );
}

export function ProgressForm({ workPackage }: { workPackage: WorkPackageRecord }) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend(`/api/ascend/packages/${workPackage.id}/progress`, {
      percentComplete: Number(data.get('percentComplete')),
      status: String(data.get('status') ?? '') || undefined,
      note: String(data.get('note') ?? '') || undefined,
    });
  });

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', flexWrap: 'wrap' }}
    >
      <div>
        <span style={{ fontSize: '11px', color: '#64748b' }}>%</span>
        <input
          name="percentComplete"
          type="number"
          min={0}
          max={100}
          step={1}
          required
          defaultValue={workPackage.percentComplete}
          style={{ ...inputStyle, width: '70px', marginBottom: 0 }}
        />
      </div>
      <select
        name="status"
        defaultValue={workPackage.status}
        style={{ ...inputStyle, width: '130px', marginBottom: 0 }}
      >
        <option value="not_started">Not started</option>
        <option value="in_progress">In progress</option>
        <option value="complete">Complete</option>
        <option value="on_hold">On hold</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <input
        name="note"
        placeholder="Note (optional)"
        maxLength={4000}
        style={{ ...inputStyle, width: '160px', marginBottom: 0 }}
      />
      <button type="submit" disabled={pending} style={secondaryButtonStyle}>
        {pending ? '…' : 'Report'}
      </button>
      {error ? (
        <span style={{ color: '#ef4444', fontSize: '12px', width: '100%' }}>
          {error}
        </span>
      ) : null}
    </form>
  );
}

export function LinkUnitsControl({
  projectId,
  linkedUnitIds,
  units,
}: {
  projectId: string;
  linkedUnitIds: string[];
  units: ElevatorUnitRecord[];
}) {
  const router = useRouter();
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend(`/api/ascend/projects/${projectId}/units`, {
      unitId: String(data.get('unitId') ?? ''),
    });
  });

  async function unlink(unitId: string) {
    await fetch(`/api/ascend/projects/${projectId}/units?unitId=${unitId}`, {
      method: 'DELETE',
    });
    router.refresh();
  }

  const unlinked = units.filter((u) => !linkedUnitIds.includes(u.id));

  return (
    <div>
      <FormError message={error} />
      {linkedUnitIds.length > 0 ? (
        <ul style={{ margin: '0 0 8px', paddingLeft: '18px', fontSize: '13px' }}>
          {linkedUnitIds.map((id) => {
            const unit = units.find((u) => u.id === id);
            return (
              <li key={id} style={{ marginBottom: '4px' }}>
                {unit ? `${unit.unitNumber} (${unit.buildingName})` : id}{' '}
                <button
                  type="button"
                  onClick={() => unlink(id)}
                  style={secondaryButtonStyle}
                >
                  Unlink
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {unlinked.length > 0 ? (
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: '6px' }}>
          <select
            name="unitId"
            required
            defaultValue=""
            style={{ ...inputStyle, marginBottom: 0, maxWidth: '280px' }}
          >
            <option value="" disabled>
              Link a unit…
            </option>
            {unlinked.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitNumber} — {u.buildingName}
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending} style={secondaryButtonStyle}>
            {pending ? '…' : 'Link'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
