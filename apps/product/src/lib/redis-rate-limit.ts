import { Redis } from '@upstash/redis';

const RATE_LIMIT_PREFIX = 'ratelimit:';
const BUCKET_TTL_MS = 86_400_000; // 24h — a bucket idle past this is dropped.

// Token-bucket limiter implemented as a Lua script so the check-and-decrement
// is atomic and free of the fixed-window reset race (see #42). Stored state is
// [tokens, lastRefillMs]; refill is continuous, so there is no burst at a
// minute boundary and a Redis flush that drops a key simply restarts a full
// bucket — which the caller's local backstop (rateLimitWithFallback) then
// constrains.
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerMinute = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local raw = redis.call('GET', key)
local tokens, lastRefill
if raw then
  local parts = cjson.decode(raw)
  tokens = parts[1]
  lastRefill = parts[2]
else
  tokens = capacity
  lastRefill = now
end
local elapsedMinutes = math.max(0, now - lastRefill) / 60000
tokens = math.min(capacity, tokens + elapsedMinutes * refillPerMinute)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('SET', key, cjson.encode({ tokens, now }), 'PX', ARGV[4])
return allowed
`;

export type RedisRateLimitOptions = {
  capacity?: number;
  refillPerMinute?: number;
};

export interface RateLimiter {
  check(key: string, options?: RedisRateLimitOptions): Promise<boolean>;
}

function createRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redisClient = createRedisClient();

export function isRedisRateLimitConfigured(): boolean {
  return redisClient !== null;
}

async function redisRateLimit(
  key: string,
  options: RedisRateLimitOptions = {},
): Promise<boolean> {
  const client = redisClient;
  if (!client) return false;

  const capacity = options.capacity ?? 10;
  const refillPerMinute = options.refillPerMinute ?? 10;
  const fullKey = `${RATE_LIMIT_PREFIX}${key}`;

  const result = await client.eval(
    TOKEN_BUCKET_SCRIPT,
    [fullKey],
    [capacity, refillPerMinute, Date.now(), BUCKET_TTL_MS],
  );

  return result === 1;
}

export const distributedRateLimiter: RateLimiter = {
  async check(key: string, options?: RedisRateLimitOptions): Promise<boolean> {
    if (isRedisRateLimitConfigured()) {
      return redisRateLimit(key, options);
    }
    return false;
  },
};

/**
 * Applies a shared (Redis) limit and, when present, OR-applies the local limit.
 *
 * Two failure modes are closed here that a single Redis bucket would otherwise
 * open (see #42):
 *   1. Redis is down/unavailable -> fall back to this process's local bucket.
 *   2. Redis grants a token (e.g. after a flush drops the key and restarts a
 *      full bucket) -> the local bucket is still consulted, so a flush cannot
 *      silently reset every limit back to full across the fleet.
 */
export async function rateLimitWithFallback(
  key: string,
  options: RedisRateLimitOptions = {},
): Promise<boolean> {
  if (isRedisRateLimitConfigured()) {
    try {
      const distributed = await redisRateLimit(key, options);
      if (!distributed) return false;
      const { rateLimit: localRateLimit } = await import('./rate-limit');
      return localRateLimit(key, options);
    } catch (error) {
      console.error('Distributed rate limiter error, falling back to local:', error);
    }
  }

  const { rateLimit: localRateLimit } = await import('./rate-limit');
  return localRateLimit(key, options);
}
