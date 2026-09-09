import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Nonce-based strict CSP (see proxy.ts / #46) requires dynamic rendering so a
// fresh nonce can be injected into framework scripts on every request.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'J-Box Control',
  description: 'Operator plane: organization lifecycle and provisioning.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
