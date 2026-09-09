'use client';

import { useState } from 'react';
import {
  parseDollarsToCents,
  parseHoursToHundredths,
} from '@/lib/ascend/money-input';
import type {
  ElevatorUnitRecord,
  WorkPackageRecord,
} from '@/lib/ascend/ascend-records';
import { PART_STATUSES } from '@/lib/ascend/project-part-contract';
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
import type { ProjectPartRecord } from '@/lib/ascend/ascend-records';

const COST_KINDS = ['budget', 'actual', 'committed', 'forecast'];
const COST_CATEGORIES = [
  'material',
  'labor',
  'subcontract',
  'freight',
  'engineering',
  'permits',
  'testing',
  'other',
];

function badRequest(message: string): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

export function NewCostForm({
  projectId,
  packages,
  units,
}: {
  projectId: string;
  packages: WorkPackageRecord[];
  units: ElevatorUnitRecord[];
}) {
  const [isLabor, setIsLabor] = useState(false);
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    const base = {
      projectId,
      costKind: String(data.get('costKind') ?? 'actual'),
      elevatorUnitId: String(data.get('elevatorUnitId') ?? '') || null,
      workPackageId: String(data.get('workPackageId') ?? '') || null,
      costDate: String(data.get('costDate') ?? ''),
      sourceType: String(data.get('sourceType') ?? ''),
      sourceRef: String(data.get('sourceRef') ?? ''),
      description: String(data.get('description') ?? ''),
    };
    if (isLabor) {
      const hours = parseHoursToHundredths(String(data.get('hours') ?? ''));
      const rate = parseDollarsToCents(String(data.get('rate') ?? ''));
      if (hours === null || rate === null) {
        return badRequest('Invalid hours or rate.');
      }
      return postAscend('/api/ascend/costs', {
        ...base,
        kind: 'labor',
        hoursHundredths: hours,
        rateCentsPerHour: rate,
      });
    }
    const amount = parseDollarsToCents(String(data.get('amount') ?? ''));
    if (amount === null) return badRequest('Invalid amount.');
    return postAscend('/api/ascend/costs', {
      ...base,
      kind: 'entry',
      costCategory: String(data.get('costCategory') ?? 'material'),
      amountCents: amount,
    });
  });

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>Record cost</h3>
      <FormError message={error} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Lens">
          <select name="costKind" style={inputStyle} defaultValue="actual">
            {COST_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select
            value={isLabor ? 'labor' : 'entry'}
            onChange={(e) => setIsLabor(e.target.value === 'labor')}
            style={inputStyle}
          >
            <option value="entry">Cost entry</option>
            <option value="labor">Labor (hours × rate)</option>
          </select>
        </Field>
      </div>
      {isLabor ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Hours">
            <input name="hours" required inputMode="decimal" placeholder="8.5" style={inputStyle} />
          </Field>
          <Field label="Burdened rate ($/hr)">
            <input name="rate" required inputMode="decimal" placeholder="95.00" style={inputStyle} />
          </Field>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Category">
            <select name="costCategory" style={inputStyle} defaultValue="material">
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount ($)">
            <input name="amount" required inputMode="decimal" placeholder="0.00" style={inputStyle} />
          </Field>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Work package (optional)">
          <select name="workPackageId" style={inputStyle} defaultValue="">
            <option value="">—</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Unit (optional)">
          <select name="elevatorUnitId" style={inputStyle} defaultValue="">
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitNumber}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        <Field label="Date">
          <input name="costDate" required type="date" style={inputStyle} />
        </Field>
        <Field label="Source type">
          <input name="sourceType" maxLength={60} placeholder="invoice" style={inputStyle} />
        </Field>
        <Field label="Source ref">
          <input name="sourceRef" maxLength={200} placeholder="INV-1024" style={inputStyle} />
        </Field>
      </div>
      <Field label="Description">
        <input name="description" maxLength={1000} style={inputStyle} />
      </Field>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Saving…' : 'Record cost'}
      </button>
    </form>
  );
}

export function NewPartForm({
  projectId,
  packages,
  units,
}: {
  projectId: string;
  packages: WorkPackageRecord[];
  units: ElevatorUnitRecord[];
}) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    const qty = parseHoursToHundredths(String(data.get('quantity') ?? ''));
    const planned = parseDollarsToCents(String(data.get('planned') ?? ''));
    if (qty === null || planned === null) {
      return badRequest('Invalid quantity or planned cost.');
    }
    return postAscend('/api/ascend/parts', {
      projectId,
      description: String(data.get('description') ?? ''),
      quantityRequiredHundredths: qty,
      plannedCostCents: planned,
      workPackageId: String(data.get('workPackageId') ?? '') || null,
      elevatorUnitId: String(data.get('elevatorUnitId') ?? '') || null,
      supplier: String(data.get('supplier') ?? ''),
      sourceRef: String(data.get('sourceRef') ?? ''),
      neededDate: String(data.get('neededDate') ?? '') || null,
      notes: String(data.get('notes') ?? ''),
    });
  });

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>Specify part</h3>
      <FormError message={error} />
      <Field label="Description">
        <input name="description" required minLength={2} maxLength={500} style={inputStyle} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Quantity required">
          <input name="quantity" required inputMode="decimal" placeholder="1" style={inputStyle} />
        </Field>
        <Field label="Planned cost ($)">
          <input name="planned" inputMode="decimal" placeholder="0.00" style={inputStyle} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Work package (optional)">
          <select name="workPackageId" style={inputStyle} defaultValue="">
            <option value="">—</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Unit (optional)">
          <select name="elevatorUnitId" style={inputStyle} defaultValue="">
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitNumber}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        <Field label="Supplier">
          <input name="supplier" maxLength={200} style={inputStyle} />
        </Field>
        <Field label="PO / ref">
          <input name="sourceRef" maxLength={200} style={inputStyle} />
        </Field>
        <Field label="Needed by">
          <input name="neededDate" type="date" style={inputStyle} />
        </Field>
      </div>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Saving…' : 'Specify part'}
      </button>
    </form>
  );
}

export function PartUpdateForm({ part }: { part: ProjectPartRecord }) {
  const statusSubmit = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend(`/api/ascend/parts/${part.id}/status`, {
      status: String(data.get('status') ?? ''),
      note: String(data.get('note') ?? '') || undefined,
    });
  });
  const qtySubmit = useAscendSubmit((form) => {
    const data = new FormData(form);
    const received = String(data.get('received') ?? '');
    const installed = String(data.get('installed') ?? '');
    const cost = String(data.get('cost') ?? '');
    const rq = received === '' ? undefined : parseHoursToHundredths(received);
    const iq = installed === '' ? undefined : parseHoursToHundredths(installed);
    const cc = cost === '' ? undefined : parseDollarsToCents(cost);
    if (rq === null || iq === null || cc === null) {
      return badRequest('Invalid quantity or cost.');
    }
    return postAscend(`/api/ascend/parts/${part.id}/quantity`, {
      ...(rq !== undefined ? { quantityReceivedHundredths: rq } : {}),
      ...(iq !== undefined ? { quantityInstalledHundredths: iq } : {}),
      ...(cc !== undefined ? { actualCostCents: cc } : {}),
      note: String(data.get('note') ?? '') || undefined,
    });
  });

  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <form onSubmit={statusSubmit.onSubmit} style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
        <select
          name="status"
          defaultValue={part.status}
          style={{ ...inputStyle, width: '120px', marginBottom: 0 }}
        >
          {(PART_STATUSES as readonly string[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input name="note" placeholder="Note" maxLength={4000} style={{ ...inputStyle, width: '120px', marginBottom: 0 }} />
        <button type="submit" disabled={statusSubmit.pending} style={secondaryButtonStyle}>
          Set
        </button>
      </form>
      <form onSubmit={qtySubmit.onSubmit} style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
        <input name="received" placeholder={`Recv (${part.quantityReceivedHundredths / 100})`} inputMode="decimal" style={{ ...inputStyle, width: '80px', marginBottom: 0 }} />
        <input name="installed" placeholder={`Inst (${part.quantityInstalledHundredths / 100})`} inputMode="decimal" style={{ ...inputStyle, width: '80px', marginBottom: 0 }} />
        <input name="cost" placeholder="Cost $" inputMode="decimal" style={{ ...inputStyle, width: '90px', marginBottom: 0 }} />
        <button type="submit" disabled={qtySubmit.pending} style={secondaryButtonStyle}>
          Record
        </button>
      </form>
      <FormError message={statusSubmit.error ?? qtySubmit.error} />
    </div>
  );
}
