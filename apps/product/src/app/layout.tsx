import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

// Nonce-based strict CSP (see proxy.ts / #46) requires dynamic rendering so a
// fresh nonce can be injected into framework scripts on every request.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'J-Box',
  description: 'Storefront and Field for small trade contractors.',
  viewport: 'width=device-width, initial-scale=1',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
