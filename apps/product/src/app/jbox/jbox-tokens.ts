export const COLORS = {
  bg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  borderLight: '#475569',
  amber: '#f59e0b',
  amberHover: '#eab308',
  amberMuted: 'rgba(245, 158, 11, 0.1)',
  green: '#10b981',
  greenLight: '#34d399',
  red: '#ef4444',
  redLight: '#fca5a5',
  blue: '#3b82f6',
  white: '#ffffff',
  textPrimary: '#f1f5f9',
  textSecondary: '#cbd5e1',
  textMuted: '#94a3b8',
  textDim: '#64748b',
  textDimmer: '#475569',
} as const;

export const FONT = {
  mono: 'ui-monospace, monospace',
  body: 'system-ui, -apple-system, sans-serif',
} as const;

export const STATUS_BG: Record<string, string> = {
  draft: COLORS.textDim,
  signed: COLORS.green,
  declined: COLORS.red,
  scheduled: COLORS.blue,
  in_progress: COLORS.amber,
  completed: COLORS.green,
  cancelled: COLORS.red,
  issued: COLORS.blue,
  paid: COLORS.green,
  partially_paid: COLORS.amber,
  pending_approval: COLORS.blue,
  approved: COLORS.green,
  rejected: COLORS.red,
};

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  signed: 'Approved / Signed',
  declined: 'Declined',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  draft_invoice: 'Draft',
  issued: 'Issued',
  paid: 'Paid',
  partially_paid: 'Partially Paid',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const card = { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '32px' } as const;
export const heading = { fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase' as const, color: COLORS.white, margin: '0 0 8px' } as const;
export const subtitle = { color: COLORS.textMuted, fontSize: '0.875rem', margin: 0 } as const;
export const muted = { color: COLORS.textDim, fontSize: '0.8125rem' } as const;
export const link = { color: COLORS.amber, textDecoration: 'none', fontWeight: 600 } as const;

export const table = { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.875rem' };
export const th = { textAlign: 'left' as const, padding: '10px 12px', borderBottom: `2px solid ${COLORS.border}`, color: COLORS.textDim, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' } as const;
export const td = { padding: '10px 12px', borderBottom: `1px solid ${COLORS.surface}`, color: COLORS.textSecondary } as const;

export function badge(bg: string) {
  return { display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', background: bg, color: COLORS.bg };
}

export function statusBadge(status: string) {
  return badge(STATUS_BG[status] ?? COLORS.textDim);
}
