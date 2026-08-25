'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type RoleLabel = string;

const NAV_ITEMS = [
  { label: 'Shop Control', href: '/jbox' },
  { label: 'Client Accounts', href: '/jbox/customers' },
  { label: 'Bids & Takeoffs', href: '/jbox/estimates' },
  { label: 'Work Orders', href: '/jbox/jobs' },
  { label: 'Parts & Rates Index', href: '/jbox/price-book' },
  { label: 'Billing & Tickets', href: '/jbox/invoices' },
  { label: 'AI Assistant', href: '/jbox/ai' },
];

export function JBoxSidebar({ roleLabel }: { roleLabel: RoleLabel }) {
  const pathname = usePathname();

  return (
    <aside style={{
      width: '256px', borderRight: '1px solid #1e293b', background: '#1e293b',
      padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      flexShrink: 0,
    }}>
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
    </aside>
  );
}
