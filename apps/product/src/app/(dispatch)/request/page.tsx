'use client';

import { useState } from 'react';

const CATEGORIES = [
  { value: 'electrical', label: 'Electrical', icon: '⚡' },
  { value: 'plumbing', label: 'Plumbing', icon: '🔧' },
  { value: 'hvac', label: 'HVAC / Mechanical', icon: '❄' },
  { value: 'general', label: 'General Contracting', icon: '🔨' },
] as const;

const MAX_WORK_LENGTH = 4000;

export default function DispatchRequestPage() {
  const [loading, setLoading] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [work, setWork] = useState('');
  const [location, setLocation] = useState('');

  const workLength = work.length;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/dispatch/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, workRequired: work, siteLocation: location }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Failed to submit request.');
        return;
      }
      setTicket(body.ticketNumber);
    } catch {
      setError('Could not reach dispatch. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (ticket) {
    return (
      <section className="dispatch-section" style={{ textAlign: 'center', paddingTop: '96px' }}>
        <div className="dispatch-badge" style={{ marginBottom: '24px' }}>Request Received</div>
        <h1>Your Ticket</h1>
        <p style={{ color: '#f59e0b', fontFamily: 'ui-monospace, monospace', fontSize: '2rem', fontWeight: 900, margin: '16px 0' }}>
          {ticket}
        </p>
        <p className="subdeck" style={{ margin: '0 auto 32px' }}>
          Save this ticket number. Our dispatch team will review your request
          and send a qualified technician with a firm bid.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href={`/dispatch/track?ticket=${ticket}`} className="dispatch-btn dispatch-btn-primary">
            Track This Request
          </a>
          <a href="/dispatch/request" className="dispatch-btn dispatch-btn-secondary">
            Submit Another
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="dispatch-section">
      <h1>Submit a Service Request</h1>
      <p className="subdeck">
        Describe the work you need. Our dispatch team will send a
        qualified technician and a firm bid within the hour.
      </p>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', padding: '12px', marginBottom: '20px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      <form className="dispatch-form" onSubmit={handleSubmit}>
        <div className="dispatch-field">
          <label htmlFor="category">Service Category</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '12px', borderRadius: '6px', border: '2px solid',
                  borderColor: category === cat.value ? '#f59e0b' : '#334155',
                  background: category === cat.value ? 'rgba(245, 158, 11, 0.1)' : '#0f172a',
                  color: category === cat.value ? '#f59e0b' : '#94a3b8',
                  cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                  transition: 'all 150ms',
                }}
              >
                <span style={{ fontSize: '18px' }}>{cat.icon}</span>
                {cat.label}
              </button>
            ))}
          </div>
          {!category && (
            <p style={{ color: '#64748b', fontSize: '11px', marginTop: '6px' }}>Select a category to continue</p>
          )}
        </div>

        <div className="dispatch-field">
          <label htmlFor="work">Work Required</label>
          <textarea
            id="work"
            required
            placeholder="Describe the issue or project scope..."
            value={work}
            onChange={(e) => setWork(e.target.value.slice(0, MAX_WORK_LENGTH))}
            style={{ minHeight: '120px' }}
          />
          <div style={{
            display: 'flex', justifyContent: 'flex-end', marginTop: '4px',
            fontSize: '11px', fontWeight: 600,
            color: workLength > MAX_WORK_LENGTH * 0.9 ? '#ef4444' : '#64748b',
          }}>
            {workLength.toLocaleString()} / {MAX_WORK_LENGTH.toLocaleString()}
          </div>
        </div>

        <div className="dispatch-field">
          <label htmlFor="location">Site Location / Access Notes</label>
          <input
            id="location"
            type="text"
            placeholder="Address, gate code, access instructions..."
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !category || !work.trim()}
          className="dispatch-btn dispatch-btn-submit"
        >
          {loading ? 'Sending...' : 'Send Request & Get Estimate'}
        </button>
      </form>
    </section>
  );
}
