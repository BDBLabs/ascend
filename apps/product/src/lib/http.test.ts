import { describe, expect, it } from 'vitest';
import {
  readJsonBody,
  RequestBodyTooLargeError,
} from '@/lib/http';

describe('readJsonBody', () => {
  it('parses a valid JSON body', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    await expect(readJsonBody(request, 1024)).resolves.toEqual({ a: 1 });
  });

  it('rejects a body larger than the cap even without a Content-Length header', async () => {
    // A chunked transfer-encoded request carries no Content-Length header, so a
    // header-only check would let this oversized body through (see #43).
    const request = new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ payload: 'x'.repeat(500) }),
      // deliberately omit content-length
    });
    await expect(readJsonBody(request, 100)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });

  it('rejects an oversized body with a Content-Length header', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ payload: 'x'.repeat(500) }),
    });
    await expect(readJsonBody(request, 100)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });

  it('throws a parse error for non-JSON', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: 'not json',
    });
    await expect(readJsonBody(request, 1024)).rejects.toBeInstanceOf(SyntaxError);
  });

  it('returns null for an empty body', async () => {
    const request = new Request('https://example.test', { method: 'POST' });
    await expect(readJsonBody(request, 1024)).resolves.toBeNull();
  });
});
