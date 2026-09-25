import { createHash, randomBytes } from 'node:crypto';

/**
 * Public dispatch tickets are tracked by a 256-bit bearer token issued once at
 * creation. Only its SHA-256 is stored (migration 033), so a database read does
 * not yield working tracking links, and the short human ticket number is no
 * longer a lookup key anyone can enumerate.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateTrackingToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isWellFormedTrackingToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function hashTrackingToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
