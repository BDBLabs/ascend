import Link from 'next/link';

export default function DispatchPortalHomePage() {
  return (
    <>
      <div className="dispatch-banner">
        Licensed &amp; Insured Trade Operations &bull; Live Field Dispatch
      </div>

      <main className="dispatch-hero">
        <div className="dispatch-badge">
          Commercial &amp; Residential Service Operations
        </div>

        <h1>
          Built-Right Trades.<br />
          <span className="accent">Clear Bids. Fast Response.</span>
        </h1>

        <p className="subdeck">
          Request service calls, approve scope bids, and track field
          technicians en route to your job site.
        </p>

        <div className="dispatch-cta-row">
          <Link href="/dispatch/request" className="dispatch-btn dispatch-btn-primary">
            Submit Service Request
          </Link>
          <Link href="/dispatch/track" className="dispatch-btn dispatch-btn-secondary">
            Track En-Route Tech
          </Link>
        </div>
      </main>

      <section style={{
        maxWidth: '960px', margin: '0 auto', padding: '0 24px 96px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px',
      }}>
        {[
          {
            step: '01',
            title: 'Submit Request',
            desc: 'Describe the work, select your trade, and attach site photos. Takes under a minute.',
          },
          {
            step: '02',
            title: 'Get a Firm Bid',
            desc: 'A qualified technician reviews your request and sends a fixed-price estimate — no surprises.',
          },
          {
            step: '03',
            title: 'Approve & Track',
            desc: 'Accept the bid, and track your technician en route to the job site in real time.',
          },
        ].map((item) => (
          <div key={item.step} style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '28px',
          }}>
            <div style={{
              fontFamily: 'ui-monospace, monospace', fontSize: '2rem', fontWeight: 900,
              color: '#f59e0b', marginBottom: '12px', lineHeight: 1,
            }}>
              {item.step}
            </div>
            <h3 style={{
              fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: 'white', margin: '0 0 8px',
            }}>
              {item.title}
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '0.8125rem', lineHeight: 1.6, margin: 0 }}>
              {item.desc}
            </p>
          </div>
        ))}
      </section>
    </>
  );
}
