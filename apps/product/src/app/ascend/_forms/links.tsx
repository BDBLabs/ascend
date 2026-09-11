'use client';

import type { ModernizationProjectRecord } from '@/lib/ascend/ascend-records';
import type { RecentChangeOrder } from '@/lib/ascend/change-order-links';
import {
  Field,
  FormError,
  buttonStyle,
  formBox,
  inputStyle,
  postAscend,
  useAscendSubmit,
} from './form';

export function LinkEstimateForm({
  estimateId,
  projects,
}: {
  estimateId: string;
  projects: ModernizationProjectRecord[];
}) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend(`/api/ascend/estimates/${estimateId}/project`, {
      projectId: String(data.get('projectId') ?? ''),
    });
  });

  if (projects.length === 0) return null;

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', marginTop: '6px' }}
    >
      <select
        name="projectId"
        required
        defaultValue=""
        style={{ ...inputStyle, width: '170px', marginBottom: 0 }}
      >
        <option value="" disabled>
          Link to project…
        </option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayId} ({p.customerName})
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? '…' : 'Link'}
      </button>
      {error ? (
        <span style={{ color: '#ef4444', fontSize: '12px' }}>{error}</span>
      ) : null}
    </form>
  );
}

export function LinkChangeOrderForm({
  projectId,
  orders,
  linkedIds,
}: {
  projectId: string;
  orders: RecentChangeOrder[];
  linkedIds: string[];
}) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend(`/api/ascend/projects/${projectId}/change-orders`, {
      changeOrderId: String(data.get('changeOrderId') ?? ''),
    });
  });

  const available = orders.filter((o) => !linkedIds.includes(o.changeOrderId));
  if (available.length === 0) return null;

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>
        Link change order
      </h3>
      <FormError message={error} />
      <Field label="Change order (same customer)">
        <select name="changeOrderId" required style={inputStyle} defaultValue="">
          <option value="" disabled>
            Select change order…
          </option>
          {available.map((o) => (
            <option key={o.changeOrderId} value={o.changeOrderId}>
              {o.displayId} — {o.title} ({o.status})
            </option>
          ))}
        </select>
      </Field>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Linking…' : 'Link change order'}
      </button>
    </form>
  );
}

export function CreateInvoiceButton({ applicationId }: { applicationId: string }) {
  const { pending, error, onSubmit } = useAscendSubmit(() =>
    postAscend(`/api/ascend/applications/${applicationId}/invoice`, {}),
  );

  return (
    <form onSubmit={onSubmit} style={{ display: 'inline' }}>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? '…' : 'Create invoice'}
      </button>
      {error ? (
        <span style={{ color: '#ef4444', fontSize: '12px', marginLeft: '6px' }}>
          {error}
        </span>
      ) : null}
    </form>
  );
}
