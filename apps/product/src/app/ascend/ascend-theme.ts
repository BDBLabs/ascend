/**
 * Ascend workspace theme. Self-contained (not imported from jbox-tokens)
 * so the Phase 8 rebrand touches only this workspace.
 */
import type { CSSProperties } from 'react';

export const A = {
  bg: '#0f172a',
  surface: '#1e293b',
  cardBg: '#162032',
  border: '#334155',
  amber: '#f59e0b',
  green: '#10b981',
  red: '#ef4444',
  blue: '#3b82f6',
  white: '#ffffff',
  textPrimary: '#f1f5f9',
  textSecondary: '#cbd5e1',
  textMuted: '#94a3b8',
  textDim: '#64748b',
} as const;

export const page: CSSProperties = {
  background: A.bg,
  color: A.textPrimary,
  minHeight: '100vh',
  padding: '24px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

export const heading: CSSProperties = {
  fontSize: '24px',
  fontWeight: 800,
  margin: '0 0 4px',
};

export const subtitle: CSSProperties = {
  fontSize: '13px',
  color: A.textMuted,
  margin: '0 0 20px',
};

export const card: CSSProperties = {
  background: A.cardBg,
  border: `1px solid ${A.border}`,
  borderRadius: '8px',
  padding: '16px',
};

export const cardTitle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: A.textDim,
  margin: '0 0 8px',
};

export const bigNumber: CSSProperties = {
  fontSize: '22px',
  fontWeight: 800,
  fontFamily: 'ui-monospace, monospace',
};

export const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

export const th: CSSProperties = {
  textAlign: 'left',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: A.textDim,
  padding: '8px 12px',
  borderBottom: `1px solid ${A.border}`,
};

export const td: CSSProperties = {
  padding: '10px 12px',
  borderBottom: `1px solid ${A.border}`,
  color: A.textSecondary,
};

export const money: CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

export const link: CSSProperties = {
  color: A.amber,
  textDecoration: 'none',
  fontWeight: 600,
};

export const pill = (color: string): CSSProperties => ({
  display: 'inline-block',
  fontSize: '11px',
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: '999px',
  border: `1px solid ${color}`,
  color,
  whiteSpace: 'nowrap',
});

export const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '12px',
  marginBottom: '20px',
};

export const sectionTitle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: A.textMuted,
  margin: '24px 0 12px',
};

export const muted: CSSProperties = {
  color: A.textMuted,
  fontSize: '13px',
};

export const errorBox: CSSProperties = {
  padding: '2rem',
  color: A.red,
  fontSize: '0.875rem',
};
