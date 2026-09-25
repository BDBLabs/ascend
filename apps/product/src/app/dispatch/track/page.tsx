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

/** Accepts either the bare tracking code or the full tracking link. */
function trackingTokenFrom(input: string): string {
  const trimmed = input.trim();
  try {
    return new URL(trimmed).searchParams.get('token') ?? '';
  } catch {
    return trimmed;
  }
}

export default function DispatchTrackPage() {
  const [ticketInput, setTicketInput] = useState('');
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [ticketInfo, setTicketInfo] = useState<{
    ticketNumber: string; status: string; category: string; createdAt: string;
    priority?: string; workSummary?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (ticket: string) => {
    try {
      const res = await fetch(`/api/dispatch/track?token=${encodeURIComponent(ticket)}`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.ok) {
        setActiveStep(STATUS_TO_STEP[body.status] ?? 0);
        setTicketInfo({
          ticketNumber: body.ticketNumber,
          status: body.status,
          category: body.category,
          createdAt: body.createdAt,
          priority: body.priority,
          workSummary: body.workSummary,
        });
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // The tracking link from the request confirmation opens straight onto the
  // ticket. Read once on mount; the token never leaves this page's requests.
  const initialToken = useRef<string | null>(null);
  useEffect(() => {
    if (initialToken.current !== null) return;
    initialToken.current = new URLSearchParams(window.location.search).get('token') ?? '';
    if (initialToken.current) void lookupRef.current(initialToken.current);
  }, []);

  async function lookup(input: string = ticketInput) {
    const ticket = trackingTokenFrom(input);
    if (!ticket) return;
    setLoading(true);
    setError(null);
    setActiveStep(null);
    setTicketInfo(null);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

    try {
      const res = await fetch(`/api/dispatch/track?token=${encodeURIComponent(ticket)}`);
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
        priority: body.priority,
        workSummary: body.workSummary,
      });
      intervalRef.current = setInterval(() => refresh(ticket), 30_000);
    } catch {
      setError('Could not reach dispatch. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const lookupRef = useRef(lookup);
  useEffect(() => { lookupRef.current = lookup; });

  return (
    <section className="dispatch-tracker">
      <h1>Live Job Status</h1>

      <div className="dispatch-tracker-form">
        <input
          type="text"
          placeholder="Paste your tracking link or code"
          aria-label="Tracking link or code"
          value={ticketInput}
          onChange={(e) => setTicketInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
        />
        <button
          type="button"
          className="dispatch-btn dispatch-btn-primary"
          onClick={() => lookup()}
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
              {ticketInfo.priority && ticketInfo.priority !== 'normal' && (
                <span style={{
                  marginLeft: '8px', padding: '1px 6px', borderRadius: '3px',
                  fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                  background: ticketInfo.priority === 'emergency' ? 'rgba(239,68,68,0.15)' : ticketInfo.priority === 'urgent' ? 'rgba(245,158,11,0.15)' : 'rgba(100,116,139,0.15)',
                  color: ticketInfo.priority === 'emergency' ? '#fca5a5' : ticketInfo.priority === 'urgent' ? '#fbbf24' : '#94a3b8',
                }}>
                  {ticketInfo.priority}
                </span>
              )}
            </div>
            {ticketInfo.workSummary && (
              <p style={{ fontSize: '13px', color: '#94a3b8', margin: '12px 0 0', lineHeight: 1.5 }}>
                {ticketInfo.workSummary}
              </p>
            )}
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
