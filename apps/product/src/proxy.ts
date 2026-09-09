import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAscendMode, isRetiredAscendRoute } from '@/lib/brand';
import { classifyHost } from '@/lib/host';

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Host-shape routing gate + strict Content Security Policy.
 *
 * Host routing: tenant storefronts live on `*.usejbox.com` subdomains and are
 * resolved per request in withTenant()/loadStorefront() — that needs the
 * database, so it happens in render, not here. What proxy CAN do without I/O is
 * gate on host shape: platform hosts and unknown hostnames are rewritten onto
 * the static platform shell so a tenant page can never be reached under a
 * non-tenant host. The DB-level verification still happens in withTenant(),
 * which fails closed. API routes are left alone (they resolve tenants on their
 * own).
 *
 * CSP: a per-request nonce is generated here and surfaced via the `x-nonce`
 * request header plus a `'nonce-<value>' 'strict-dynamic'` script-src. Next.js
 * attaches that nonce to its inline framework scripts during server rendering,
 * which lets us drop `'unsafe-inline'` from script-src in production (see #46).
 * Nonces require dynamic rendering; every layout is force-dynamic for that
 * reason.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Final served path, after rewrites below: layouts use it to exempt
  // the login route from the signed-out access panel. Set from the
  // rewritten URL further down, not here.
  const setPathname = (pathname: string) => {
    requestHeaders.set('x-pathname', pathname);
  };

  const init = { request: { headers: requestHeaders } };

  const next = (): NextResponse => {
    setPathname(request.nextUrl.pathname);
    const response = NextResponse.next(init);
    response.headers.set('Content-Security-Policy', buildCsp(nonce));
    return response;
  };

  const rewrite = (pathname: string): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    setPathname(pathname);
    const response = NextResponse.rewrite(url, init);
    response.headers.set('Content-Security-Policy', buildCsp(nonce));
    return response;
  };

  if (classifyHost(request.headers.get('host')) === 'tenant') {
    return next();
  }

  // Phase 8 retirements: on Ascend deployments the obsolete J-Box
  // dashboard and trade-dispatch portal answer 404. Tenant storefronts
  // return above and are unaffected; J-Box deployments leave
  // ASCEND_MODE unset and keep serving them.
  if (
    isAscendMode() &&
    isRetiredAscendRoute(request.nextUrl.pathname)
  ) {
    const response = new NextResponse('Not found', { status: 404 });
    response.headers.set('Content-Security-Policy', buildCsp(nonce));
    return response;
  }

  // Ascend prototype: the deployment root is the Field login. Tenant
  // storefronts return above and are unaffected; other deployments leave
  // ASCEND_ROOT_IS_FIELD_LOGIN unset and keep the platform shell at /.
  if (
    request.nextUrl.pathname === '/' &&
    process.env.ASCEND_ROOT_IS_FIELD_LOGIN === '1'
  ) {
    return rewrite('/field/login');
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return next();
  }

  // The Field workspace lives on the platform host (field.usejbox.com); its
  // pages and API share an origin and authenticate per request, so a platform
  // host must serve /field as-is rather than rewriting it onto the shell.
  // The Ascend workspace (/ascend) authenticates the same way and likewise
  // serves as-is: tenant storefront hosts never reach this branch.
  if (
    request.nextUrl.pathname === '/field' ||
    request.nextUrl.pathname.startsWith('/field/') ||
    request.nextUrl.pathname === '/ascend' ||
    request.nextUrl.pathname.startsWith('/ascend/')
  ) {
    return next();
  }

  const pathname = request.nextUrl.pathname;
  if (pathname === '/platform' || pathname.startsWith('/platform/')) {
    return next();
  }

  return rewrite(`/platform${pathname === '/' ? '' : pathname}`);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
