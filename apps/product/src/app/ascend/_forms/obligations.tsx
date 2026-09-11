'use client';

import type { ObligationDetail } from '@/lib/ascend/obligations';
import type {
  ActivityStatus,
  MilestoneStatus,
  ObligationStatus,
} from '@/lib/ascend/obligation-contract';
import type { WorkPackageRecord } from '@/lib/ascend/ascend-records';
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


function StatusButtons({
  current,
  options,
  action,
}: {
  current: string;
  options: string[];
  action: (status: string) => Promise<Response>;
}) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return action(String(data.get('status') ?? ''));
  });

  return (
    <form onSubmit={onSubmit} style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
      <select
        name="status"
        defaultValue={current}
        style={{ ...inputStyle, width: '120px', marginBottom: 0, padding: '4px 6px', fontSize: '12px' }}
      >
        {options.map((s) => (
          <option key={s} value={s}>
            {s.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} style={secondaryButtonStyle}>
        Set
      </button>
      {error ? <span style={{ color: '#ef4444', fontSize: '12px' }}>{error}</span> : null}
    </form>
  );
}

export function NewObligationForm({ projectId }: { projectId: string }) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend('/api/ascend/obligations', {
      projectId,
      title: String(data.get('title') ?? ''),
      description: String(data.get('description') ?? ''),
      sourceRef: String(data.get('sourceRef') ?? ''),
      dueDate: String(data.get('dueDate') ?? '') || null,
    });
  });

  return (
    <form style={formBox} onSubmit={onSubmit}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>New obligation</h3>
      <FormError message={error} />
      <Field label="Title">
        <input name="title" required minLength={2} maxLength={200} style={inputStyle} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Contract ref (e.g. §3.2)">
          <input name="sourceRef" maxLength={200} style={inputStyle} />
        </Field>
        <Field label="Due date">
          <input name="dueDate" type="date" style={inputStyle} />
        </Field>
      </div>
      <Field label="Description">
        <input name="description" maxLength={4000} style={inputStyle} />
      </Field>
      <button type="submit" disabled={pending} style={buttonStyle}>
        {pending ? 'Saving…' : 'Add obligation'}
      </button>
    </form>
  );
}

export function NewMilestoneForm({ obligationId }: { obligationId: string }) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend('/api/ascend/milestones', {
      obligationId,
      title: String(data.get('title') ?? ''),
      description: String(data.get('description') ?? ''),
      dueDate: String(data.get('dueDate') ?? '') || null,
    });
  });

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
      <input name="title" required minLength={2} maxLength={200} placeholder="Milestone title" style={{ ...inputStyle, width: '200px', marginBottom: 0 }} />
      <input name="dueDate" type="date" style={{ ...inputStyle, width: '140px', marginBottom: 0 }} />
      <button type="submit" disabled={pending} style={secondaryButtonStyle}>
        Add
      </button>
      {error ? <span style={{ color: '#ef4444', fontSize: '12px' }}>{error}</span> : null}
    </form>
  );
}

export function NewActivityForm({
  milestoneId,
  packages,
}: {
  milestoneId: string;
  packages: WorkPackageRecord[];
}) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend('/api/ascend/activities', {
      milestoneId,
      title: String(data.get('title') ?? ''),
      description: String(data.get('description') ?? ''),
      workPackageId: String(data.get('workPackageId') ?? '') || null,
      evidenceRequired: data.get('evidenceRequired') === 'on',
    });
  });

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <input name="title" required minLength={2} maxLength={200} placeholder="Activity" style={{ ...inputStyle, width: '180px', marginBottom: 0 }} />
      <select name="workPackageId" defaultValue="" style={{ ...inputStyle, width: '150px', marginBottom: 0 }}>
        <option value="">No package</option>
        {packages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label style={{ fontSize: '12px', color: '#cbd5e1' }}>
        <input type="checkbox" name="evidenceRequired" /> evidence?
      </label>
      <button type="submit" disabled={pending} style={secondaryButtonStyle}>
        Add
      </button>
      {error ? <span style={{ color: '#ef4444', fontSize: '12px' }}>{error}</span> : null}
    </form>
  );
}

export function EvidenceForm({ activityId }: { activityId: string }) {
  const { pending, error, onSubmit } = useAscendSubmit((form) => {
    const data = new FormData(form);
    return postAscend(`/api/ascend/activities/${activityId}/evidence`, {
      kind: String(data.get('kind') ?? 'note'),
      ref: String(data.get('ref') ?? ''),
      note: String(data.get('note') ?? ''),
    });
  });

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
      <select name="kind" defaultValue="note" style={{ ...inputStyle, width: '100px', marginBottom: 0 }}>
        <option value="note">note</option>
        <option value="document">document</option>
        <option value="photo">photo</option>
        <option value="event">event</option>
        <option value="other">other</option>
      </select>
      <input name="ref" placeholder="Ref / link" maxLength={1000} style={{ ...inputStyle, width: '150px', marginBottom: 0 }} />
      <input name="note" placeholder="Note" maxLength={1000} style={{ ...inputStyle, width: '150px', marginBottom: 0 }} />
      <button type="submit" disabled={pending} style={secondaryButtonStyle}>
        Attach
      </button>
      {error ? <span style={{ color: '#ef4444', fontSize: '12px' }}>{error}</span> : null}
    </form>
  );
}

const OBLIGATION_OPTIONS = ['open', 'satisfied', 'waived'];
const MILESTONE_OPTIONS = ['pending', 'met', 'missed', 'waived'];
const ACTIVITY_OPTIONS = ['pending', 'done', 'waived'];

export function ObligationTree({
  detail,
  packages,
}: {
  detail: ObligationDetail;
  packages: WorkPackageRecord[];
}) {
  const { obligation } = detail;
  return (
    <div style={{ borderLeft: '3px solid #334155', paddingLeft: '12px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '14px' }}>{obligation.title}</strong>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
          {obligation.sourceRef ? `${obligation.sourceRef} · ` : ''}{obligation.status}
          {obligation.dueDate ? ` · due ${obligation.dueDate}` : ''}
        </span>
        <StatusButtons
          current={obligation.status}
          options={OBLIGATION_OPTIONS}
          action={(status) =>
            postAscend(`/api/ascend/obligations/${obligation.id}/status`, {
              status: status as ObligationStatus,
            })
          }
        />
      </div>
      {detail.milestones.map(({ milestone, activities }) => (
        <div key={milestone.id} style={{ marginTop: '10px', marginLeft: '12px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px' }}>◆ {milestone.title}</span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {milestone.status}
              {milestone.dueDate ? ` · due ${milestone.dueDate}` : ''}
            </span>
            <StatusButtons
              current={milestone.status}
              options={MILESTONE_OPTIONS}
              action={(status) =>
                postAscend(`/api/ascend/milestones/${milestone.id}/status`, {
                  status: status as MilestoneStatus,
                })
              }
            />
          </div>
          <div style={{ marginLeft: '16px' }}>
            {activities.map(({ activity, evidence }) => (
              <div key={activity.id} style={{ marginTop: '6px', fontSize: '13px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>
                    ○ {activity.title}
                    {activity.workPackageName ? ` [${activity.workPackageName}]` : ''}
                  </span>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                    {activity.status}
                    {activity.evidenceRequired ? ' · evidence required' : ''} ·{' '}
                    {activity.evidenceCount} evidence
                  </span>
                  <StatusButtons
                    current={activity.status}
                    options={ACTIVITY_OPTIONS}
                    action={(status) =>
                      postAscend(`/api/ascend/activities/${activity.id}/status`, {
                        status: status as ActivityStatus,
                      })
                    }
                  />
                </div>
                {evidence.map((e) => (
                  <div key={e.id} style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '16px' }}>
                    [{e.kind}] {e.ref || e.note}
                    {e.ref && e.note ? ` — ${e.note}` : ''}
                  </div>
                ))}
                <div style={{ marginLeft: '16px' }}>
                  <EvidenceForm activityId={activity.id} />
                </div>
              </div>
            ))}
            <NewActivityForm milestoneId={milestone.id} packages={packages} />
          </div>
        </div>
      ))}
      <NewMilestoneForm obligationId={obligation.id} />
    </div>
  );
}
