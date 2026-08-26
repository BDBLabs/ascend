'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

type RoleLabel = string;

const NAV_ITEMS = [
  { label: 'Shop Control', href: '/jbox' },
  { label: 'Client Accounts', href: '/jbox/customers' },
  { label: 'Bids & Takeoffs', href: '/jbox/estimates' },
  { label: 'Work Orders', href: '/jbox/jobs' },
  { label: 'Change Orders', href: '/jbox/change-orders' },
  { label: 'Parts & Rates Index', href: '/jbox/price-book' },
  { label: 'Billing & Tickets', href: '/jbox/invoices' },
  { label: 'AI Assistant', href: '/jbox/ai' },
];

export function JBoxSidebar({ roleLabel }: { roleLabel: RoleLabel }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const navContent = (
    <>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px' }}>
          <span style={{
            background: '#f59e0b', color: '#0f172a', fontWeight: 900,
            padding: '6px 10px', borderRadius: '4px', fontSize: '13px', letterSpacing: '0.1em',
          }}>
            J-BOX
          </span>
          <span style={{
            fontWeight: 700, letterSpacing: '0.1em', fontSize: '11px',
            textTransform: 'uppercase', color: '#94a3b8',
          }}>
            Job Management System
          </span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/jbox'
              ? pathname === '/jbox'
              : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: isActive ? '#f59e0b' : '#cbd5e1',
                  background: isActive ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                  textDecoration: 'none',
                  transition: 'background 150ms, color 150ms',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div style={{
        borderTop: '1px solid #334155', paddingTop: '16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: '11px', fontFamily: 'ui-monospace, monospace', color: '#64748b',
      }}>
        <span>{roleLabel}</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          color: '#34d399', fontWeight: 700, textTransform: 'uppercase',
        }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
          Active
        </span>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        style={{
          display: 'none',
          position: 'fixed', top: '12px', left: '12px', zIndex: 1100,
          background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
          padding: '8px', cursor: 'pointer', color: '#f59e0b',
        }}
        className="jbox-mobile-menu-btn"
        aria-label="Toggle menu"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          {mobileOpen ? (
            <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
          ) : (
            <>
              <rect x="3" y="4" width="14" height="2" rx="1" />
              <rect x="3" y="9" width="14" height="2" rx="1" />
              <rect x="3" y="14" width="14" height="2" rx="1" />
            </>
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            display: 'none',
            position: 'fixed', inset: 0, zIndex: 998,
            background: 'rgba(0,0,0,0.5)',
          }}
          className="jbox-mobile-overlay"
        />
      )}

      {/* Desktop sidebar */}
      <aside style={{
        width: '256px', borderRight: '1px solid #1e293b', background: '#1e293b',
        padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        {navContent}
      </aside>

      {/* Mobile drawer */}
      <aside
        className="jbox-mobile-drawer"
        style={{
          position: 'fixed', top: 0, left: mobileOpen ? 0 : '-280px',
          width: '280px', height: '100vh', zIndex: 999,
          background: '#1e293b', borderRight: '1px solid #334155',
          padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          transition: 'left 200ms ease-in-out',
          overflowY: 'auto',
        }}
      >
        {navContent}
      </aside>

      <style>{`
        @media (max-width: 768px) {
          .jbox-mobile-menu-btn { display: block !important; }
          .jbox-mobile-overlay { display: block !important; }
          .jbox-mobile-drawer { display: flex !important; }
        }
      `}</style>
    </>
  );
}
