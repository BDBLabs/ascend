import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getFieldPrincipal } from '@/lib/field-api-auth';
import { isFieldAuthConfigured } from '@/lib/identity-environment';
import { ROLE_LABELS } from '@/lib/identity';
import { JBoxSidebar } from './jbox-sidebar';
import { JBoxErrorBoundary } from './jbox-error-boundary';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'J-Box Job Management',
  description: 'Job management system for trade contractors.',
  robots: { index: false, follow: false },
};

export default async function JBoxLayout({ children }: { children: ReactNode }) {
  const principal = await getFieldPrincipal();

  if (!principal) {
    if (isFieldAuthConfigured()) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#f1f5f9' }}>
          <section style={{ textAlign: 'center', padding: '48px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f59e0b', marginBottom: '12px' }}>
              J-BOX
            </p>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase', margin: '0 0 8px' }}>
              Sign in required
            </h1>
            <p style={{ color: '#94a3b8', marginBottom: '24px' }}>
              Authenticate to access the Job Management System.
            </p>
            <Link href="/field/login" style={{ display: 'inline-block', background: '#f59e0b', color: '#0f172a', padding: '12px 24px', borderRadius: '6px', fontWeight: 900, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', textDecoration: 'none' }}>
              Sign in
            </Link>
          </section>
        </main>
      );
    }

    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#f1f5f9' }}>
        <section style={{ textAlign: 'center', padding: '48px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase' }}>
            Staff access not configured
          </h1>
        </section>
      </main>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <JBoxSidebar roleLabel={ROLE_LABELS[principal.role]} />
      <main style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
        <JBoxErrorBoundary>{children}</JBoxErrorBoundary>
      </main>
    </div>
  );
}
