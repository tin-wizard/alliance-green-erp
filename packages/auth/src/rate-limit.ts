/**
 * Fixed-window rate limiter for login.
 *
 * Single process, in memory: correct for the LAN deployment (one Node process)
 * and deliberately simple. Restarting the server clears the counters. Upgrade
 * path is a `login_attempts` table shared by all instances.
 */
export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitOptions {
  limit: number
  windowMs: number
  now?: number
}

export function consumeRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = options.now ?? Date.now()
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs })
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 }
  }

  if (existing.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    }
  }

  existing.count += 1
  return { allowed: true, remaining: options.limit - existing.count, retryAfterSeconds: 0 }
}

export function resetRateLimit(key?: string): void {
  if (key === undefined) buckets.clear()
  else buckets.delete(key)
}

/** Housekeeping so the map cannot grow without bound on a long-running server. */
export function pruneRateLimits(now = Date.now()): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}
