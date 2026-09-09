'use client';

import type { ProgressApplicationRecord } from '@/lib/ascend/ascend-records';
import type { BillingPeriodRecord } from '@/lib/ascend/ascend-records';
import { parseDollarsToCents } from '@/lib/ascend/money-input';
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

function badRequest(message: string): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

export function ScheduleForm({
  projectId,
  currentPercent,
}: {
  projectId: string;
  currentPercent: number | null;
}) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend('/api/ascend/schedules', {
      projectId,
      retainagePercent: Number(data.get('retainagePercent')),
      notes: String(data.get('notes') ?? ''),
    });
  });

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>
        Billing schedule{currentPercent !== null ? ` (retainage ${currentPercent}%)` : ''}
      </h3>
      <FormError message={error} />
      <Field label="Retainage percent (0–100)">
        <input
          name="retainagePercent"
          type="number"
          min={0}
          max={100}
          step={1}
          required
          defaultValue={currentPercent ?? 10}
          style={inputStyle}
        />
      </Field>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Saving…' : 'Set schedule'}
      </button>
    </form>
  );
}

export function NewPeriodForm({
  projectId,
  nextNumber,
}: {
  projectId: string;
  nextNumber: number;
}) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend('/api/ascend/periods', {
      projectId,
      periodNumber: Number(data.get('periodNumber')),
      periodStart: String(data.get('periodStart') ?? ''),
      periodEnd: String(data.get('periodEnd') ?? ''),
    });
  });

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>New billing period</h3>
      <FormError message={error} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        <Field label="Number">
          <input
            name="periodNumber"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={nextNumber}
            style={inputStyle}
          />
        </Field>
        <Field label="Start">
          <input name="periodStart" type="date" required style={inputStyle} />
        </Field>
        <Field label="End">
          <input name="periodEnd" type="date" required style={inputStyle} />
        </Field>
      </div>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Saving…' : 'Open period'}
      </button>
    </form>
  );
}

export function NewApplicationForm({
  openPeriods,
  appliedPeriodIds,
}: {
  openPeriods: BillingPeriodRecord[];
  appliedPeriodIds: string[];
}) {
  const available = openPeriods.filter((p) => !appliedPeriodIds.includes(p.id));
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    const stored = parseDollarsToCents(String(data.get('stored') ?? ''));
    if (stored === null) return badRequest('Invalid stored materials value.');
    return postAscend('/api/ascend/applications', {
      billingPeriodId: String(data.get('billingPeriodId') ?? ''),
      storedMaterialsCents: stored,
      notes: String(data.get('notes') ?? ''),
    });
  });

  if (available.length === 0) return null;

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>Draft application</h3>
      <FormError message={error} />
      <Field label="Period">
        <select name="billingPeriodId" required style={inputStyle} defaultValue="">
          <option value="" disabled>
            Select period…
          </option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.periodNumber} ({p.periodStart} → {p.periodEnd})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Stored materials ($)">
        <input name="stored" inputMode="decimal" placeholder="0.00" style={inputStyle} />
      </Field>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Saving…' : 'Draft application'}
      </button>
    </form>
  );
}

export function ApplicationActions({
  application,
}: {
  application: ProgressApplicationRecord;
}) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend(`/api/ascend/applications/${application.id}`, {
      action: String(data.get('action') ?? ''),
      note: String(data.get('note') ?? '') || undefined,
      invoiceId: String(data.get('invoiceId') ?? '') || undefined,
    });
  });

  const actions: string[] = [];
  if (application.status === 'draft') actions.push('submit');
  if (application.status === 'submitted') actions.push('approve', 'reject');
  if (application.status === 'approved') actions.push('invoice');
  const canVoid = application.status === 'draft';

  if (actions.length === 0 && !canVoid) return null;

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '8px' }}
    >
      <select name="action" required defaultValue="" style={{ ...inputStyle, width: '130px', marginBottom: 0 }}>
        <option value="" disabled>
          Action…
        </option>
        {actions.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
        {canVoid ? <option value="void">void draft</option> : null}
      </select>
      {actions.includes('invoice') ? (
        <input
          name="invoiceId"
          placeholder="Invoice UUID"
          style={{ ...inputStyle, width: '220px', marginBottom: 0 }}
        />
      ) : null}
      <input
        name="note"
        placeholder="Note (optional)"
        maxLength={4000}
        style={{ ...inputStyle, width: '160px', marginBottom: 0 }}
      />
      <button type="submit" disabled={pending} style={secondaryButtonStyle}>
        {pending ? '…' : 'Apply'}
      </button>
      {error ? (
        <span style={{ color: '#ef4444', fontSize: '12px', width: '100%' }}>
          {error}
        </span>
      ) : null}
    </form>
  );
}
