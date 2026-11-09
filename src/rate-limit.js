export function createRateLimiter({ windowMs, max, clock }) {
  const hits = new Map();
  return {
    check(key) {
      const now = clock();
      const fresh = (hits.get(key) || []).filter((stamp) => now - stamp < windowMs);
      if (fresh.length >= max) {
        hits.set(key, fresh);
        return { allowed: false, retryAfterMs: Math.max(1, windowMs - (now - fresh[0])) };
      }
      fresh.push(now);
      hits.set(key, fresh);
      if (hits.size > 5000) {
        for (const [id, stamps] of hits) {
          if (stamps.every((stamp) => now - stamp >= windowMs)) hits.delete(id);
        }
      }
      return { allowed: true, retryAfterMs: 0 };
    }
  };
}
