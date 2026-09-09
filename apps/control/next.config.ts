import type { NextConfig } from 'next';

/**
 * Security headers are split between here and src/proxy.ts:
 * - The Content-Security-Policy is set in proxy.ts because it needs a per-
 *   request nonce ('nonce-<value>' 'strict-dynamic', no 'unsafe-inline' in
 *   script-src — see #46). Static headers that do not vary per request live
 *   here.
 */
const nextConfig: NextConfig = {
  // Emits a self-contained Node server with only the dependencies it actually
  // uses, so a container image does not carry the whole monorepo's
  // node_modules. Required for running as a long-lived process (Fly) rather
  // than as per-request functions. On Vercel the platform builds serverless
  // functions itself, and a standalone trace conflicts with its build hook, so
  // the output is standalone only when not on Vercel.
  output: process.env.VERCEL ? undefined : 'standalone',
  // Workspace packages export TS source directly; Next must compile them.
  transpilePackages: [
    '@contractor-platform/configuration',
    '@contractor-platform/database',
  ],
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ],
    }];
  },
};

export default nextConfig;
