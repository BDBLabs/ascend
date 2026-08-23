'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const STEPS = [
  'Request Received',
  'Estimate Dispatched',
  'Work Approved',
  'Tech En Route',
  'Job Completed & Paid',
] as const;

const STATUS_TO_STEP: Record<string, number> = {
  pending: 0,
  reviewing: 1,
  bid_sent: 2,
  approved: 3,
  in_progress: 4,
  completed: 5,
};

const CATEGORY_LABELS: Record<string, string> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  general: 'General',
};

export default function DispatchTrackPage() {
  const [ticketInput, setTicketInput] = useState('');
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [ticketInfo, setTicketInfo] = useState<{ ticketNumber: string; status: string; category: string; createdAt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (ticket: string) => {
    try {
      const res = await fetch(`/api/dispatch/track?ticket=${encodeURIComponent(ticket)}`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.ok) {
        setActiveStep(STATUS_TO_STEP[body.status] ?? 0);
        setTicketInfo({
          ticketNumber: body.ticketNumber,
          status: body.status,
          category: body.category,
          createdAt: body.createdAt,
        });
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  async function lookup() {
    const ticket = ticketInput.trim();
    if (!ticket) return;
    setLoading(true);
    setError(null);
    setActiveStep(null);
    setTicketInfo(null);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

    try {
      const res = await fetch(`/api/dispatch/track?ticket=${encodeURIComponent(ticket)}`);
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Ticket not found.');
        return;
      }
      const step = STATUS_TO_STEP[body.status] ?? 0;
      setActiveStep(step);
      setTicketInfo({
        ticketNumber: body.ticketNumber,
        status: body.status,
        category: body.category,
        createdAt: body.createdAt,
      });
      intervalRef.current = setInterval(() => refresh(ticket), 30_000);
    } catch {
      setError('Could not reach dispatch. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dispatch-tracker">
      <h1>Live Job Status</h1>

      <div className="dispatch-tracker-form">
        <input
          type="text"
          placeholder="DRQ-000000"
          aria-label="Job ticket number"
          value={ticketInput}
          onChange={(e) => setTicketInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
        />
        <button
          type="button"
          className="dispatch-btn dispatch-btn-primary"
          onClick={lookup}
          disabled={loading}
        >
          {loading ? 'Looking...' : 'Look Up'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', padding: '12px', marginBottom: '24px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {activeStep !== null && ticketInfo && (
        <div className="dispatch-stepper">
          <div style={{ marginBottom: '24px', paddingBottom: '20px', borderBottom: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.25rem', fontWeight: 900, color: '#f59e0b' }}>
                {ticketInfo.ticketNumber}
              </span>
              <span style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: '4px',
                fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.04em',
                background: activeStep >= 5 ? '#10b981' : '#f59e0b',
                color: '#0f172a',
              }}>
                {activeStep >= 5 ? 'Complete' : 'In Progress'}
              </span>
              {intervalRef.current && (
                <span style={{ fontSize: '11px', color: '#475569', letterSpacing: '0.04em' }}>
                  Auto-refreshing every 30s
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              {CATEGORY_LABELS[ticketInfo.category] ?? ticketInfo.category} &middot; Filed {new Date(ticketInfo.createdAt).toLocaleDateString()}
            </div>
          </div>

          {STEPS.map((step, i) => {
            const isCompleted = i < activeStep;
            const isActive = i === activeStep;
            const isLast = i === STEPS.length - 1;

            return (
              <div className="dispatch-step" key={step}>
                <div className="dispatch-step-indicator">
                  <div
                    className={`dispatch-step-dot${isCompleted ? ' completed' : ''}${isActive ? ' active' : ''}`}
                  />
                  {!isLast && (
                    <div
                      className={`dispatch-step-line${isCompleted ? ' completed' : ''}`}
                    />
                  )}
                </div>
                <div className="dispatch-step-content">
                  <div
                    className={`dispatch-step-label${isCompleted ? ' completed' : ''}${isActive ? ' active' : ''}`}
                  >
                    {step}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
