'use client';

import { useEffect, useState } from 'react';
import styles from '../../field/field.module.css';

export function ResetPasswordForm() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Read once, then drop it from the address bar and history.
    const value = new URLSearchParams(window.location.search).get('token') ?? '';
    setToken(value);
    if (value) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; detail?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error === 'weak-password'
          ? payload.detail ?? 'Choose a stronger password.'
          : 'This link is invalid, already used, or expired. Ask your administrator for a new one.');
        return;
      }
      setDone(true);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className={styles.alertOk} role="status">Password set. <a href="/field">Sign in</a>.</p>;
  }
  if (!token) {
    return <p className={styles.alertError} role="alert">This page needs the link your administrator sent you.</p>;
  }

  return (
    <form className={styles.loginForm} onSubmit={submit}>
      <label className={styles.fieldLabel} htmlFor="new-password">New password</label>
      <input
        id="new-password"
        className={styles.searchInput}
        autoComplete="new-password"
        minLength={12}
        maxLength={256}
        required
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <label className={styles.fieldLabel} htmlFor="confirm-password">Confirm password</label>
      <input
        id="confirm-password"
        className={styles.searchInput}
        autoComplete="new-password"
        required
        type="password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      <p className={styles.accessMuted}>At least 12 characters. Avoid common passwords and your email address.</p>
      {error && <p className={styles.alertError} role="alert">{error}</p>}
      <button className={styles.button} disabled={busy || !password || !confirm} type="submit">
        {busy ? 'Saving…' : 'Set password'}
      </button>
    </form>
  );
}
