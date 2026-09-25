'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './field.module.css';

type Notice = { kind: 'error' | 'info'; message: string };
type OrganizationChoice = { organizationId: string; name: string; role: string };

const ERROR_MESSAGES: Record<string, string> = {
  'invalid-credentials': 'Email, password or code is incorrect.',
  'too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'invalid-body': 'Enter your email and password.',
};

/**
 * Sign-in in up to three steps, each a POST to /api/auth/login:
 *   1. email + password;
 *   2. if the login belongs to several organizations (shown only after the
 *      password was verified), pick one;
 *   3. if that membership requires MFA, a 6-digit authenticator code.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizations, setOrganizations] = useState<OrganizationChoice[] | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(organizationId ? { organizationId } : {}),
          ...(needsCode ? { totpToken: code } : {}),
        }),
      });
      const payload = await response.json() as {
        error?: string;
        ok?: boolean;
        organizations?: OrganizationChoice[];
      };
      if (payload.error === 'organization-required' && payload.organizations?.length) {
        setOrganizations(payload.organizations);
        setOrganizationId(payload.organizations[0].organizationId);
        setNotice({ kind: 'info', message: 'Choose the organization to sign in to.' });
        return;
      }
      if (payload.error === 'mfa-required') {
        setNeedsCode(true);
        setNotice({ kind: 'info', message: 'Enter the 6-digit code from your authenticator app.' });
        return;
      }
      if (!response.ok || !payload.ok) {
        setCode('');
        setNotice({
          kind: 'error',
          message: ERROR_MESSAGES[payload.error ?? ''] ?? 'Sign-in failed.',
        });
        return;
      }
      router.push('/field');
      router.refresh();
    } catch {
      setNotice({ kind: 'error', message: 'Sign-in failed. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(email && password && (!needsCode || /^\d{6}$/.test(code)));

  return (
    <form className={styles.loginForm} onSubmit={submit}>
      <label className={styles.fieldLabel} htmlFor="email">Email</label>
      <input
        id="email"
        className={styles.searchInput}
        autoComplete="email"
        autoFocus
        inputMode="email"
        maxLength={320}
        required
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label className={styles.fieldLabel} htmlFor="password">Password</label>
      <input
        id="password"
        className={styles.searchInput}
        autoComplete="current-password"
        maxLength={1024}
        required
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {organizations && (
        <>
          <label className={styles.fieldLabel} htmlFor="organization">Organization</label>
          <select
            id="organization"
            className={styles.searchInput}
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          >
            {organizations.map((choice) => (
              <option key={choice.organizationId} value={choice.organizationId}>
                {choice.name} ({choice.role})
              </option>
            ))}
          </select>
        </>
      )}
      {needsCode && (
        <>
          <label className={styles.fieldLabel} htmlFor="totp">Authenticator code</label>
          <input
            id="totp"
            className={styles.searchInput}
            autoComplete="one-time-code"
            autoFocus
            inputMode="numeric"
            maxLength={6}
            pattern="\d{6}"
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          />
        </>
      )}
      {notice && (
        <p className={notice.kind === 'error' ? styles.alertError : styles.alertOk} role="alert">
          {notice.message}
        </p>
      )}
      <button className={styles.button} disabled={busy || !ready} type="submit">
        {busy ? 'Signing in…' : needsCode ? 'Verify and sign in' : 'Sign in'}
      </button>
      <p className={styles.accessMuted}>
        Forgotten your password? Ask your administrator for a reset link.
      </p>
    </form>
  );
}
