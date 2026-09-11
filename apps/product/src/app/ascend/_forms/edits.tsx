'use client';

import { useState } from 'react';
import { parseDollarsToCents } from '@/lib/ascend/money-input';
import type {
  ModernizationProjectRecord,
  ProjectCostEntryRecord,
  ProjectPartRecord,
  WorkPackageRecord,
} from '@/lib/ascend/ascend-records';
import type { CostKind } from '@/lib/ascend/project-cost-contract';
import {
  Field,
  FormError,
  buttonStyle,
  formBox,
  inputStyle,
  secondaryButtonStyle,
  useAscendSubmit,
} from './form';

function centsOrBad(
  raw: string,
): { cents: number } | { error: string } {
  if (raw.trim() === '') return { cents: 0 };
  const parsed = parseDollarsToCents(raw);
  return parsed === null ? { error: 'Invalid dollar value.' } : { cents: parsed };
}

function Toggle({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={secondaryButtonStyle}
      >
        {open ? 'Close' : label}
      </button>
      {open ? <div style={{ marginTop: '8px' }}>{children}</div> : null}
    </span>
  );
}

export function EditProjectForm({
  project,
}: {
  project: ModernizationProjectRecord;
}) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    const contract = centsOrBad(String(data.get('contractValue') ?? ''));
    if ('error' in contract) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: contract.error }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return fetch(`/api/ascend/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: String(data.get('status') ?? ''),
        contractValueCents: contract.cents,
        projectManager: String(data.get('projectManager') ?? ''),
        startDate: String(data.get('startDate') ?? '') || null,
        targetCompletionDate:
          String(data.get('targetCompletionDate') ?? '') || null,
        actualCompletionDate:
          String(data.get('actualCompletionDate') ?? '') || null,
        notes: String(data.get('notes') ?? ''),
      }),
    });
  });

  return (
    <Toggle label="Edit project">
      <form style={formBox} onSubmit={onSubmit}>
        <FormError message={error} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Status">
            <select name="status" defaultValue={project.status} style={inputStyle}>
              <option value="prospect">Prospect</option>
              <option value="bidding">Bidding</option>
              <option value="awarded">Awarded</option>
              <option value="in_progress">In progress</option>
              <option value="substantially_complete">Substantially complete</option>
              <option value="closed">Closed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
          <Field label="Contract value ($)">
            <input
              name="contractValue"
              inputMode="decimal"
              defaultValue={(project.contractValueCents / 100).toFixed(2)}
              style={inputStyle}
            />
          </Field>
        </div>
        <Field label="Project manager">
          <input
            name="projectManager"
            maxLength={200}
            defaultValue={project.projectManager}
            style={inputStyle}
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <Field label="Start">
            <input
              name="startDate"
              type="date"
              defaultValue={project.startDate ?? ''}
              style={inputStyle}
            />
          </Field>
          <Field label="Target">
            <input
              name="targetCompletionDate"
              type="date"
              defaultValue={project.targetCompletionDate ?? ''}
              style={inputStyle}
            />
          </Field>
          <Field label="Actual finish">
            <input
              name="actualCompletionDate"
              type="date"
              defaultValue={project.actualCompletionDate ?? ''}
              style={inputStyle}
            />
          </Field>
        </div>
        <Field label="Notes">
          <input
            name="notes"
            maxLength={4000}
            defaultValue={project.notes}
            style={inputStyle}
          />
        </Field>
        <button type="submit" disabled={pending} style={buttonStyle}>
          {pending ? 'Saving…' : 'Save project'}
        </button>
      </form>
    </Toggle>
  );
}

export function EditPackageForm({ pkg }: { pkg: WorkPackageRecord }) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    const budget = centsOrBad(String(data.get('budget') ?? ''));
    const sell = centsOrBad(String(data.get('sell') ?? ''));
    if ('error' in budget || 'error' in sell) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'Invalid dollar value.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return fetch(`/api/ascend/packages/${pkg.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: String(data.get('name') ?? ''),
        category: String(data.get('category') ?? ''),
        description: String(data.get('description') ?? ''),
        budgetCostCents: budget.cents,
        contractValueCents: sell.cents,
        plannedStart: String(data.get('plannedStart') ?? '') || null,
        plannedFinish: String(data.get('plannedFinish') ?? '') || null,
        actualStart: String(data.get('actualStart') ?? '') || null,
        actualFinish: String(data.get('actualFinish') ?? '') || null,
        responsiblePerson: String(data.get('responsiblePerson') ?? ''),
        notes: String(data.get('notes') ?? ''),
      }),
    });
  });

  return (
    <Toggle label="Edit">
      <form style={{ ...formBox, maxWidth: '640px' }} onSubmit={onSubmit}>
        <FormError message={error} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Name">
            <input
              name="name"
              required
              minLength={2}
              maxLength={200}
              defaultValue={pkg.name}
              style={inputStyle}
            />
          </Field>
          <Field label="Category">
            <input
              name="category"
              maxLength={120}
              defaultValue={pkg.category}
              style={inputStyle}
            />
          </Field>
        </div>
        <Field label="Description">
          <input
            name="description"
            maxLength={4000}
            defaultValue={pkg.description}
            style={inputStyle}
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Budget ($)">
            <input
              name="budget"
              inputMode="decimal"
              defaultValue={(pkg.budgetCostCents / 100).toFixed(2)}
              style={inputStyle}
            />
          </Field>
          <Field label="Sell ($)">
            <input
              name="sell"
              inputMode="decimal"
              defaultValue={(pkg.contractValueCents / 100).toFixed(2)}
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Planned start">
            <input
              name="plannedStart"
              type="date"
              defaultValue={pkg.plannedStart ?? ''}
              style={inputStyle}
            />
          </Field>
          <Field label="Planned finish">
            <input
              name="plannedFinish"
              type="date"
              defaultValue={pkg.plannedFinish ?? ''}
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Actual start">
            <input
              name="actualStart"
              type="date"
              defaultValue={pkg.actualStart ?? ''}
              style={inputStyle}
            />
          </Field>
          <Field label="Actual finish">
            <input
              name="actualFinish"
              type="date"
              defaultValue={pkg.actualFinish ?? ''}
              style={inputStyle}
            />
          </Field>
        </div>
        <Field label="Responsible">
          <input
            name="responsiblePerson"
            maxLength={200}
            defaultValue={pkg.responsiblePerson}
            style={inputStyle}
          />
        </Field>
        <button type="submit" disabled={pending} style={buttonStyle}>
          {pending ? 'Saving…' : 'Save package'}
        </button>
      </form>
    </Toggle>
  );
}

const KIND_LABEL: Record<CostKind, string> = {
  budget: 'budget',
  actual: 'actual',
  committed: 'committed',
  forecast: 'forecast',
};

export function EditCostForm({ entry }: { entry: ProjectCostEntryRecord }) {
  const editable = entry.costKind !== 'actual';
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    const amount = centsOrBad(String(data.get('amount') ?? ''));
    if ('error' in amount) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: amount.error }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return fetch(`/api/ascend/costs/${entry.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amountCents: amount.cents,
        costDate: String(data.get('costDate') ?? ''),
        description: String(data.get('description') ?? ''),
        sourceType: String(data.get('sourceType') ?? ''),
        sourceRef: String(data.get('sourceRef') ?? ''),
      }),
    });
  });

  if (!editable) {
    return (
      <span style={{ fontSize: '12px', color: '#64748b' }}>
        Posted actual — correct with a new entry.
      </span>
    );
  }

  return (
    <Toggle label={`Edit ${KIND_LABEL[entry.costKind]}`}>
      <form style={{ ...formBox, maxWidth: '480px' }} onSubmit={onSubmit}>
        <FormError message={error} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Amount ($)">
            <input
              name="amount"
              required
              inputMode="decimal"
              defaultValue={(entry.amountCents / 100).toFixed(2)}
              style={inputStyle}
            />
          </Field>
          <Field label="Date">
            <input
              name="costDate"
              required
              type="date"
              defaultValue={entry.costDate ?? ''}
              style={inputStyle}
            />
          </Field>
        </div>
        <Field label="Description">
          <input
            name="description"
            maxLength={1000}
            defaultValue={entry.description}
            style={inputStyle}
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Source type">
            <input
              name="sourceType"
              maxLength={60}
              defaultValue={entry.sourceType}
              style={inputStyle}
            />
          </Field>
          <Field label="Source ref">
            <input
              name="sourceRef"
              maxLength={200}
              defaultValue={entry.sourceRef}
              style={inputStyle}
            />
          </Field>
        </div>
        <button type="submit" disabled={pending} style={buttonStyle}>
          {pending ? 'Saving…' : 'Save entry'}
        </button>
      </form>
    </Toggle>
  );
}

export function EditPartForm({ part }: { part: ProjectPartRecord }) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    const planned = centsOrBad(String(data.get('planned') ?? ''));
    if ('error' in planned) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: planned.error }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return fetch(`/api/ascend/parts/${part.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: String(data.get('description') ?? ''),
        supplier: String(data.get('supplier') ?? ''),
        sourceRef: String(data.get('sourceRef') ?? ''),
        neededDate: String(data.get('neededDate') ?? '') || null,
        notes: String(data.get('notes') ?? ''),
        plannedCostCents: planned.cents,
      }),
    });
  });

  return (
    <Toggle label="Edit">
      <form style={{ ...formBox, maxWidth: '480px' }} onSubmit={onSubmit}>
        <FormError message={error} />
        <Field label="Description">
          <input
            name="description"
            required
            minLength={2}
            maxLength={500}
            defaultValue={part.description}
            style={inputStyle}
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Supplier">
            <input
              name="supplier"
              maxLength={200}
              defaultValue={part.supplier}
              style={inputStyle}
            />
          </Field>
          <Field label="PO / ref">
            <input
              name="sourceRef"
              maxLength={200}
              defaultValue={part.sourceRef}
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Field label="Needed by">
            <input
              name="neededDate"
              type="date"
              defaultValue={part.neededDate ?? ''}
              style={inputStyle}
            />
          </Field>
          <Field label="Planned ($)">
            <input
              name="planned"
              inputMode="decimal"
              defaultValue={(part.plannedCostCents / 100).toFixed(2)}
              style={inputStyle}
            />
          </Field>
        </div>
        <Field label="Notes">
          <input
            name="notes"
            maxLength={4000}
            defaultValue={part.notes}
            style={inputStyle}
          />
        </Field>
        <button type="submit" disabled={pending} style={buttonStyle}>
          {pending ? 'Saving…' : 'Save part'}
        </button>
      </form>
    </Toggle>
  );
}
