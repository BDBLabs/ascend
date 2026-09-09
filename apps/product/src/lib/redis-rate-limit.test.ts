import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('redis-rate-limit fallback behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('isRedisRateLimitConfigured returns false when env vars are missing', async () => {
    const { isRedisRateLimitConfigured } = await import('./redis-rate-limit');
    expect(isRedisRateLimitConfigured()).toBe(false);
  });

  it('rateLimitWithFallback falls back to local when Redis not configured', async () => {
    const { rateLimitWithFallback } = await import('./redis-rate-limit');
    const key = 'test-key-fallback-1';
    const options = { capacity: 2, refillPerMinute: 10 };

    expect(await rateLimitWithFallback(key, options)).toBe(true);
    expect(await rateLimitWithFallback(key, options)).toBe(true);
    expect(await rateLimitWithFallback(key, options)).toBe(false);
  });

  it('distributedRateLimiter.check returns false when Redis not configured', async () => {
    const { distributedRateLimiter } = await import('./redis-rate-limit');
    const key = 'test-key-distributed-1';
    const options = { capacity: 5, refillPerMinute: 10 };

    const result = await distributedRateLimiter.check(key, options);
    expect(result).toBe(false);
  });

  it('rateLimitWithFallback enforces limits when Redis is configured', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock-redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    // Redis ALWAYS grants (as it would right after a flush that dropped the
    // bucket). The local token-bucket backstop must still be consulted, so the
    // capacity-2 local limit binds on the third call — closing the
    // short-circuit that previously reset all limits to full after a flush.
    const evalMock = vi.fn().mockResolvedValue(1);

    vi.doMock('@upstash/redis', () => ({
      Redis: class {
        eval = evalMock;
      },
    }));

    const { rateLimitWithFallback } = await import('./redis-rate-limit');
    const key = 'test-key-redis-1';
    const options = { capacity: 2, refillPerMinute: 10 };

    expect(await rateLimitWithFallback(key, options)).toBe(true);
    expect(await rateLimitWithFallback(key, options)).toBe(true);
    expect(await rateLimitWithFallback(key, options)).toBe(false);
  });

  it('rateLimitWithFallback denies when Redis denies even if local still allows', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock-redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const evalMock = vi.fn().mockResolvedValue(0);

    vi.doMock('@upstash/redis', () => ({
      Redis: class {
        eval = evalMock;
      },
    }));

    const { rateLimitWithFallback } = await import('./redis-rate-limit');
    const key = 'test-key-redis-deny-1';
    const options = { capacity: 5, refillPerMinute: 10 };

    expect(await rateLimitWithFallback(key, options)).toBe(false);
  });
});