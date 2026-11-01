export function createRateLimiter(options: {
  max: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}) {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const hits = new Map<string, number[]>();

  return {
    check(key: string): { allowed: boolean; retryAfterSeconds: number } {
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
    reset(): void {
      hits.clear();
    },
  };
}

// This limit is per server process, which is sufficient for the public form.
export const applicationRateLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
