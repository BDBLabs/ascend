'use client';

import type { BuildingRecord } from '@/lib/ascend/ascend-records';
import { parseDollarsToCents } from '@/lib/ascend/money-input';
import type { CustomerRecord } from '@/lib/customers';
import {
  Field,
  FormError,
  buttonStyle,
  formBox,
  inputStyle,
  postAscend,
  useAscendSubmit,
} from './form';

export function NewBuildingForm({ customers }: { customers: CustomerRecord[] }) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend('/api/ascend/buildings', {
      customerId: String(data.get('customerId') ?? ''),
      name: String(data.get('name') ?? ''),
      address: String(data.get('address') ?? ''),
      city: String(data.get('city') ?? ''),
      state: String(data.get('state') ?? ''),
      postalCode: String(data.get('postalCode') ?? ''),
      primaryContact: String(data.get('primaryContact') ?? ''),
      contactPhone: String(data.get('contactPhone') ?? ''),
      contactEmail: String(data.get('contactEmail') ?? ''),
    });
  });

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>New building</h3>
      <FormError message={error} />
      <Field label="Customer">
        <select name="customerId" required style={inputStyle} defaultValue="">
          <option value="" disabled>
            Select customer…
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Building name">
        <input name="name" required minLength={2} maxLength={200} style={inputStyle} />
      </Field>
      <Field label="Address">
        <input name="address" maxLength={200} style={inputStyle} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        <Field label="City">
          <input name="city" maxLength={100} style={inputStyle} />
        </Field>
        <Field label="State">
          <input name="state" maxLength={100} style={inputStyle} />
        </Field>
        <Field label="Postal">
          <input name="postalCode" maxLength={20} style={inputStyle} />
        </Field>
      </div>
      <Field label="Primary contact">
        <input name="primaryContact" maxLength={200} style={inputStyle} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Contact phone">
          <input name="contactPhone" maxLength={40} style={inputStyle} />
        </Field>
        <Field label="Contact email">
          <input name="contactEmail" maxLength={320} style={inputStyle} />
        </Field>
      </div>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Saving…' : 'Add building'}
      </button>
    </form>
  );
}

export function NewUnitForm({ buildings }: { buildings: BuildingRecord[] }) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend('/api/ascend/units', {
      buildingId: String(data.get('buildingId') ?? ''),
      unitNumber: String(data.get('unitNumber') ?? ''),
      elevatorNumber: String(data.get('elevatorNumber') ?? ''),
      manufacturer: String(data.get('manufacturer') ?? ''),
      model: String(data.get('model') ?? ''),
      elevatorType: String(data.get('elevatorType') ?? ''),
      stops: data.get('stops') ? Number(data.get('stops')) : null,
      controllerManufacturer: String(data.get('controllerManufacturer') ?? ''),
      controllerModel: String(data.get('controllerModel') ?? ''),
      existingCondition: String(data.get('existingCondition') ?? ''),
    });
  });

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>New elevator unit</h3>
      <FormError message={error} />
      <Field label="Building">
        <select name="buildingId" required style={inputStyle} defaultValue="">
          <option value="" disabled>
            Select building…
          </option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.customerName})
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Unit number">
          <input name="unitNumber" required maxLength={60} style={inputStyle} />
        </Field>
        <Field label="Car number">
          <input name="elevatorNumber" maxLength={60} style={inputStyle} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        <Field label="Manufacturer">
          <input name="manufacturer" maxLength={120} style={inputStyle} />
        </Field>
        <Field label="Model">
          <input name="model" maxLength={120} style={inputStyle} />
        </Field>
        <Field label="Type">
          <select name="elevatorType" style={inputStyle} defaultValue="">
            <option value="">—</option>
            <option value="traction">Traction</option>
            <option value="hydraulic">Hydraulic</option>
            <option value="machine_room_less">Machine room-less</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        <Field label="Stops">
          <input name="stops" type="number" min={1} step={1} style={inputStyle} />
        </Field>
        <Field label="Controller make">
          <input name="controllerManufacturer" maxLength={120} style={inputStyle} />
        </Field>
        <Field label="Controller model">
          <input name="controllerModel" maxLength={120} style={inputStyle} />
        </Field>
      </div>
      <Field label="Existing condition">
        <input name="existingCondition" maxLength={4000} style={inputStyle} />
      </Field>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Saving…' : 'Add unit'}
      </button>
    </form>
  );
}

export function NewProjectForm({
  customers,
  buildings,
}: {
  customers: CustomerRecord[];
  buildings: BuildingRecord[];
}) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    const contractValueCents = parseDollarsToCents(
      String(data.get('contractValue') ?? ''),
    );
    if (contractValueCents === null) {
      return new Response(JSON.stringify({ error: 'Invalid contract value.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return postAscend('/api/ascend/projects', {
      displayId: String(data.get('displayId') ?? '').trim().toUpperCase(),
      customerId: String(data.get('customerId') ?? ''),
      buildingId: String(data.get('buildingId') ?? '') || null,
      status: String(data.get('status') ?? '') || undefined,
      contractValueCents,
      projectManager: String(data.get('projectManager') ?? ''),
      startDate: String(data.get('startDate') ?? '') || null,
      targetCompletionDate: String(data.get('targetCompletionDate') ?? '') || null,
    });
  });

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>New project</h3>
      <FormError message={error} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Project number (e.g. ASC-0007)">
          <input
            name="displayId"
            required
            pattern="[A-Z0-9][A-Z0-9-]{2,31}"
            style={{ ...inputStyle, textTransform: 'uppercase' }}
          />
        </Field>
        <Field label="Status">
          <select name="status" style={inputStyle} defaultValue="prospect">
            <option value="prospect">Prospect</option>
            <option value="bidding">Bidding</option>
            <option value="awarded">Awarded</option>
            <option value="in_progress">In progress</option>
          </select>
        </Field>
      </div>
      <Field label="Customer">
        <select name="customerId" required style={inputStyle} defaultValue="">
          <option value="" disabled>
            Select customer…
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Building (optional)">
        <select name="buildingId" style={inputStyle} defaultValue="">
          <option value="">—</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.customerName})
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Contract value ($)">
          <input
            name="contractValue"
            required
            inputMode="decimal"
            placeholder="0.00"
            style={inputStyle}
          />
        </Field>
        <Field label="Project manager">
          <input name="projectManager" maxLength={200} style={inputStyle} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Start date">
          <input name="startDate" type="date" style={inputStyle} />
        </Field>
        <Field label="Target completion">
          <input name="targetCompletionDate" type="date" style={inputStyle} />
        </Field>
      </div>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Saving…' : 'Create project'}
      </button>
    </form>
  );
}
