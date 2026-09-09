import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { fieldPrincipalCan, getFieldPrincipal } from '@/lib/field-api-auth';
import { A } from './ascend-theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ascend — Elevator Modernization',
  description: 'Project execution, parts, cost, progress, and billing for elevator modernization.',
  robots: { index: false, follow: false },
};

const NAV: Array<{ href: string; label: string }> = [
  { href: '/ascend', label: 'Dashboard' },
  { href: '/ascend/projects', label: 'Projects' },
  { href: '/ascend/buildings', label: 'Buildings' },
  { href: '/ascend/elevators', label: 'Elevators' },
  { href: '/ascend/bids', label: 'Bids' },
  { href: '/ascend/progress', label: 'Progress' },
  { href: '/ascend/costs', label: 'Costs' },
  { href: '/ascend/parts', label: 'Parts' },
  { href: '/ascend/billing', label: 'Billing' },
];

/**
 * Ascend workspace shell. Same authentication posture as Field: any
 * staff principal may enter (gated on jobs.read, which every staff role
 * holds); per-page reads run inside withFieldContext. Tenant storefront
 * hosts never render this tree — the proxy serves tenant pages there.
 */
export default async function AscendLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!fieldPrincipalCan(principal, 'jobs.read')) {
    return (
      <div style={{ padding: '2rem', color: A.red, fontSize: '0.875rem' }}>
        Your staff role does not include access to this workspace.
      </div>
    );
  }

  return (
    <div style={{ background: A.bg, color: A.textPrimary, minHeight: '100vh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          padding: '12px 24px',
          borderBottom: `1px solid ${A.border}`,
          background: A.surface,
          flexWrap: 'wrap',
        }}
      >
        <Link
          href="/ascend"
          style={{
            color: A.white,
            fontWeight: 800,
            fontSize: '16px',
            textDecoration: 'none',
            letterSpacing: '0.04em',
          }}
        >
          ASCEND
        </Link>
        <nav style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                color: A.textSecondary,
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: 600,
                padding: '6px 10px',
                borderRadius: '6px',
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
