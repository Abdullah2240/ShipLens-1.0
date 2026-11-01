// In-memory sliding-window rate limiter, per server process. Enough for a single instance;
// a shared store is needed once the service runs more than one process. No framework imports.

export interface RateLimiter {
  /** Records a hit for the key when allowed; a refused hit is not recorded. */
  check(key: string): { allowed: boolean; retryAfterSeconds: number };
  reset(): void;
}

export function createRateLimiter(options: {
  max: number;
  windowMs: number;
  now?: () => number;
  /** Oldest key is evicted once this many keys are tracked (default 10 000). */
  maxKeys?: number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const hits = new Map<string, number[]>();

  return {
    check(key) {
      const time = now();
      const recent = (hits.get(key) ?? []).filter((stamp) => time - stamp < options.windowMs);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + options.windowMs - time) / 1000)),
        };
      }
      if (!hits.has(key) && hits.size >= maxKeys) hits.delete(hits.keys().next().value!);
      recent.push(time);
      hits.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    reset() {
      hits.clear();
    },
  };
}

/**
 * The client address as the platform proxy saw it: the first x-forwarded-for entry,
 * trimmed (later hops are client-controlled). Same rule as route(); 'unknown' when absent.
 */
export function clientIpFrom(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
