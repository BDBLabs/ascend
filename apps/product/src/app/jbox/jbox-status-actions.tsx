'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { JobStatus } from '@/lib/job-contract';
import { COLORS, STATUS_LABELS, statusBadge } from './jbox-tokens';

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

type Props = { jobId: string; currentStatus: JobStatus };

export function JobStatusActions({ jobId, currentStatus }: Props) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);

  const targets = TRANSITIONS[currentStatus];
  if (targets.length === 0) return null;

  const handleTransition = async (target: JobStatus) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/field/jobs/${jobId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        alert(body?.error ?? 'Failed to update status');
        return;
      }
      router.refresh();
    } catch {
      alert('Network error — could not update status.');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
      {targets.map((target) => (
        <button
          key={target}
          disabled={updating}
          onClick={() => handleTransition(target)}
          style={{
            background: target === 'cancelled' ? 'rgba(239, 68, 68, 0.15)' : COLORS.amberBg,
            color: target === 'cancelled' ? '#fca5a5' : COLORS.amber,
            border: `2px solid ${target === 'cancelled' ? 'rgba(239, 68, 68, 0.3)' : COLORS.amberBorder}`,
            borderRadius: '6px',
            padding: '8px 16px',
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
            cursor: updating ? 'wait' : 'pointer',
            opacity: updating ? 0.5 : 1,
          }}
        >
          Mark {STATUS_LABELS[target] ?? target}
        </button>
      ))}
    </div>
  );
}
