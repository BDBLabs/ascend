import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { AwsClient } from 'aws4fetch';

/**
 * Private object storage for customer photos (P4.1).
 *
 * Two backends, chosen at call time:
 *
 *   s3     Any S3-compatible private bucket (AWS S3, Cloudflare R2, ...).
 *          Selected when STORAGE_S3_BUCKET is set. Objects are written with
 *          no public ACL; the bucket must block public access. Required on
 *          serverless hosts, whose filesystem is ephemeral.
 *            STORAGE_S3_BUCKET, STORAGE_S3_REGION (default us-east-1),
 *            STORAGE_S3_ENDPOINT (optional, e.g. https://<acct>.r2.cloudflarestorage.com),
 *            STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY.
 *
 *   local  A directory (STORAGE_DIR, else ./uploads). Durable only on a host
 *          with a persistent volume (a Fly machine with a mounted volume) or in
 *          development.
 *
 * Fail closed: in production with no bucket, the local backend is used only if
 * STORAGE_DIR is set explicitly (a deliberate volume). On Vercel the local
 * backend is refused outright -- a write there would "succeed" into a
 * filesystem that disappears with the function instance.
 *
 * Keys are opaque relative paths (`requests/<uuid>.<ext>`); the schema stores
 * the key, never a URL.
 */

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

type Backend = 'local' | 's3';

export function storageBackend(): Backend {
  if (process.env.STORAGE_S3_BUCKET?.trim()) return 's3';
  if (process.env.VERCEL) {
    throw new StorageUnavailableError(
      'Photo storage is not configured: set STORAGE_S3_BUCKET (serverless filesystems are ephemeral).',
    );
  }
  if (process.env.NODE_ENV === 'production' && !process.env.STORAGE_DIR?.trim()) {
    throw new StorageUnavailableError(
      'Photo storage is not configured: set STORAGE_S3_BUCKET or an explicit STORAGE_DIR volume.',
    );
  }
  return 'local';
}

/**
 * The local storage root. Read at call time (not module scope) so tests can
 * point it at a temp directory per case.
 */
export function storageRoot(): string {
  // Dev fallback only. The ignore comment is turbopack's documented opt-out for
  // this cwd-relative path.
  return process.env.STORAGE_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), 'uploads');
}

function newKey(extension: string): string {
  const safeExtension = /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'bin';
  return `requests/${randomUUID()}.${safeExtension}`;
}

function assertKey(key: string): void {
  if (!key || key.includes('\0') || !/^[a-z]+\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/.test(key)) {
    throw new Error('Invalid storage key.');
  }
}

// ---------------------------------------------------------------------------
// S3-compatible backend
// ---------------------------------------------------------------------------

function s3Config() {
  const bucket = process.env.STORAGE_S3_BUCKET?.trim() ?? '';
  const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID?.trim() ?? '';
  const secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY?.trim() ?? '';
  const region = process.env.STORAGE_S3_REGION?.trim() || 'us-east-1';
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new StorageUnavailableError('S3 storage requires bucket, access key id and secret.');
  }
  const endpoint = (process.env.STORAGE_S3_ENDPOINT?.trim() || `https://s3.${region}.amazonaws.com`)
    .replace(/\/+$/, '');
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new StorageUnavailableError('STORAGE_S3_ENDPOINT must use https in production.');
  }
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, region, service: 's3' }),
    // Path-style addressing works for S3 and every S3-compatible provider.
    objectUrl: (key: string) => `${endpoint}/${encodeURIComponent(bucket)}/${key}`,
  };
}

async function s3Request(method: 'PUT' | 'GET' | 'DELETE', key: string, body?: Buffer, contentType?: string) {
  const { client, objectUrl } = s3Config();
  const response = await client.fetch(objectUrl(key), {
    method,
    body: body ? new Uint8Array(body) : undefined,
    headers: body
      ? {
          'Content-Type': contentType ?? 'application/octet-stream',
          // Refuse to overwrite: keys are random, so an existing object means
          // a collision or a replay, never a legitimate update.
          'If-None-Match': '*',
        }
      : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (method === 'DELETE' && (response.ok || response.status === 404)) return response;
  if (!response.ok) {
    throw new Error(`Object storage ${method} failed with status ${response.status}.`);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Local backend
// ---------------------------------------------------------------------------

function resolveWithinStorage(key: string): string {
  if (!key || key.includes('\0')) throw new Error('Invalid storage key.');
  const rawRoot = storageRoot();
  const root = normalize(
    isAbsolute(rawRoot) ? rawRoot : join(/*turbopackIgnore: true*/ process.cwd(), rawRoot),
  );
  const resolved = normalize(join(root, key));
  if (!resolved.startsWith(root)) {
    throw new Error('Storage key escapes the storage root.');
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function saveUpload(
  buffer: Buffer,
  extension: string,
  contentType = 'application/octet-stream',
): Promise<string> {
  const key = newKey(extension);
  if (storageBackend() === 's3') {
    await s3Request('PUT', key, buffer, contentType);
    return key;
  }
  const absolute = resolveWithinStorage(key);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer, { flag: 'wx' });
  return key;
}

export async function readUpload(key: string): Promise<Buffer> {
  if (storageBackend() === 's3') {
    assertKey(key);
    const response = await s3Request('GET', key);
    return Buffer.from(await response.arrayBuffer());
  }
  return readFile(resolveWithinStorage(key));
}

/** Idempotent: deleting a missing object succeeds. */
export async function deleteUpload(key: string): Promise<void> {
  if (storageBackend() === 's3') {
    assertKey(key);
    await s3Request('DELETE', key);
    return;
  }
  await rm(resolveWithinStorage(key), { force: true });
}
