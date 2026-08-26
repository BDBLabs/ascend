'use client';

import { useState } from 'react';

type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled';

type Props = {
  invoiceId: string;
  status: InvoiceStatus;
  updatedAt: string;
  totalCents: number;
  amountPaidCents: number;
};

export function JBoxInvoiceActions({ invoiceId, status, updatedAt, totalCents, amountPaidCents }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [currentPaid, setCurrentPaid] = useState(amountPaidCents);
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState(updatedAt);

  async function callApi(action: string, body?: Record<string, unknown>) {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/field/invoices/${invoiceId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: currentUpdatedAt, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Action failed');
      setCurrentStatus(data.invoice.status);
      setCurrentPaid(data.invoice.amountPaidCents);
      setCurrentUpdatedAt(data.invoice.updatedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setLoading(null);
    }
  }

  function handleRecordPayment() {
    const remaining = totalCents - currentPaid;
    const input = prompt(`Record payment (max $${(remaining / 100).toFixed(2)}):`, (remaining / 100).toFixed(2));
    if (!input) return;
    const cents = Math.round(parseFloat(input) * 100);
    if (!cents || cents <= 0) { setError('Invalid amount'); return; }
    callApi('payment', { amountCents: cents });
  }

  const canIssue = currentStatus === 'draft';
  const canCancel = currentStatus === 'draft' || currentStatus === 'issued';
  const canPay = currentStatus === 'issued' || currentStatus === 'partially_paid';

  if (!canIssue && !canCancel && !canPay) return null;

  const btnStyle = (bg: string) => ({
    display: 'inline-block', padding: '8px 16px', borderRadius: '6px',
    border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 700,
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
    background: bg, color: '#0f172a',
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' as const }}>
      {canIssue && (
        <button onClick={() => callApi('issue')} disabled={loading !== null} style={btnStyle('#f59e0b')}>
          {loading === 'issue' ? 'Issuing…' : 'Issue Invoice'}
        </button>
      )}
      {canPay && (
        <button onClick={handleRecordPayment} disabled={loading !== null} style={btnStyle('#10b981')}>
          Record Payment
        </button>
      )}
      {canCancel && (
        <button onClick={() => { if (confirm('Cancel this invoice?')) callApi('cancel'); }} disabled={loading !== null} style={btnStyle('#475569')}>
          {loading === 'cancel' ? 'Cancelling…' : 'Cancel'}
        </button>
      )}
      {error && <span style={{ color: '#ef4444', fontSize: '12px' }}>{error}</span>}
    </div>
  );
}
