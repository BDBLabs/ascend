import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteUpload,
  readUpload,
  saveUpload,
  StorageUnavailableError,
  storageBackend,
  storageRoot,
} from '@/lib/storage';

describe('storage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jbox-storage-'));
    process.env.STORAGE_DIR = dir;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.STORAGE_DIR;
  });

  it('points at the configured storage root', () => {
    expect(storageRoot()).toBe(dir);
  });

  it('saves a photo and reads it back with the same bytes', async () => {
    const key = await saveUpload(Buffer.from('hello-photo'), 'jpg');
    expect(key).toMatch(/^requests\/[0-9a-f-]+\.jpg$/);
    expect((await readUpload(key)).toString()).toBe('hello-photo');
  });

  it('sanitizes an extension that is not a safe token', async () => {
    const key = await saveUpload(Buffer.from('x'), '../../../etc/passwd');
    expect(key.endsWith('.bin')).toBe(true);
  });

  it('refuses keys that escape the storage root', async () => {
    await expect(readUpload('../secret')).rejects.toThrow();
    await expect(readUpload('/etc/passwd')).rejects.toThrow();
  });
});

describe('storage backend selection (fail closed)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the local directory in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(storageBackend()).toBe('local');
  });

  it('refuses the ephemeral filesystem on Vercel without a bucket', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('STORAGE_DIR', '/tmp/not-durable');
    expect(() => storageBackend()).toThrow(StorageUnavailableError);
  });

  it('refuses an implicit ./uploads directory in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_DIR', '');
    expect(() => storageBackend()).toThrow(StorageUnavailableError);
  });

  it('allows an explicit volume directory in production (Fly)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_DIR', '/data/uploads');
    expect(storageBackend()).toBe('local');
  });

  it('prefers the bucket whenever one is configured', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('STORAGE_S3_BUCKET', 'jbox-photos');
    expect(storageBackend()).toBe('s3');
  });
});

describe('S3-compatible backend', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('STORAGE_S3_BUCKET', 'jbox-photos');
    vi.stubEnv('STORAGE_S3_REGION', 'us-east-1');
    vi.stubEnv('STORAGE_S3_ENDPOINT', 'https://objects.example.test');
    vi.stubEnv('STORAGE_S3_ACCESS_KEY_ID', 'AKIDEXAMPLE');
    vi.stubEnv('STORAGE_S3_SECRET_ACCESS_KEY', 'secret-example');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('PUTs a signed, non-overwriting private object and returns an opaque key', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const key = await saveUpload(Buffer.from('jpeg-bytes'), 'jpg', 'image/jpeg');
    expect(key).toMatch(/^requests\/[0-9a-f-]{36}\.jpg$/);

    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.method).toBe('PUT');
    expect(request.url).toBe(`https://objects.example.test/jbox-photos/${key}`);
    expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(request.headers.get('if-none-match')).toBe('*');
    expect(request.headers.get('content-type')).toBe('image/jpeg');
    expect(request.headers.get('x-amz-acl')).toBeNull();
  });

  it('surfaces a failed write', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(saveUpload(Buffer.from('x'), 'jpg', 'image/jpeg')).rejects.toThrow('status 403');
  });

  it('treats deleting a missing object as success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(deleteUpload('requests/0b8a0f6e-8f8f-4a4a-9b9b-0c0c0c0c0c0c.jpg')).resolves.toBeUndefined();
  });

  it('refuses a malformed key before any request', async () => {
    await expect(readUpload('../other-bucket/secret')).rejects.toThrow('Invalid storage key.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
