import 'server-only';

/**
 * Shared response helpers for private endpoints (Field API, webhooks, cron).
 *
 * Every response here is un-cacheable and un-indexable: the body carries
 * tenant data, so it must never be cached by a shared cache, and search engines
 * must never learn its URL schema.
 */

export const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
} as const;

export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}

export function privateText(body: string, status = 200): Response {
  return new Response(body, { status, headers: PRIVATE_HEADERS });
}

/**
 * Raised when a request body exceeds the caller's cap. Distinct from a JSON
 * parse error so the handler can return the right status.
 */
export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the allowed size.');
    this.name = 'RequestBodyTooLargeError';
  }
}

/**
 * Reads and parses a JSON request body while enforcing a hard byte cap on the
 * ACTUAL body size — not just the `Content-Length` header. A client that sends
 * chunked transfer-encoding omits `Content-Length`, so a header-only check
 * lets an arbitrarily large body through (see #43). Reading the body bytes and
 * measuring them closes that gap regardless of encoding.
 *
 * Throws RequestBodyTooLargeError when the body is too big, and SyntaxError
 * when the body is not valid JSON.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }
  const raw = new TextDecoder().decode(buffer);
  if (raw.trim() === '') return null;
  return JSON.parse(raw);
}
