'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { A } from '../ascend-theme';

export const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: A.bg,
  color: A.textPrimary,
  border: `1px solid ${A.border}`,
  borderRadius: '6px',
  padding: '8px 10px',
  fontSize: '13px',
  marginBottom: '8px',
};

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: A.textDim,
  marginBottom: '4px',
};

export const buttonStyle: React.CSSProperties = {
  background: A.amber,
  color: '#0f172a',
  border: 'none',
  borderRadius: '6px',
  padding: '8px 16px',
  fontSize: '13px',
  fontWeight: 800,
  cursor: 'pointer',
};

export const secondaryButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: A.textSecondary,
  border: `1px solid ${A.border}`,
  borderRadius: '6px',
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 700,
  cursor: 'pointer',
};

export const formBox: React.CSSProperties = {
  background: A.cardBg,
  border: `1px solid ${A.border}`,
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '16px',
  maxWidth: '560px',
};

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p style={{ color: A.red, fontSize: '12px', margin: '0 0 8px' }}>{message}</p>
  );
}

type SubmitFn = (
  form: HTMLFormElement,
) => Response | Promise<Response>;

/**
 * Wires a form element to a JSON POST: prevents default, posts, surfaces
 * errors, refreshes server data on success, and resets the form.
 */
export function useAscendSubmit(submit: SubmitFn) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await submit(event.currentTarget);
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setError(payload?.error ?? `Request failed (${response.status}).`);
        return;
      }
      event.currentTarget.reset();
      router.refresh();
    } catch {
      setError('Request failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return { pending, error, onSubmit };
}

export async function postAscend(
  path: string,
  payload: Record<string, unknown>,
  init?: RequestInit,
): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    ...(init ?? {}),
  });
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: 'block', marginBottom: '4px' }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}
