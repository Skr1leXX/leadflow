/** Shortest plausible time to fill the form; faster than this is a script. */
export const MIN_FILL_MS = 2_000;
export type SpamVerdict = "ok" | "honeypot" | "too_fast";

/** The honeypot is a field real users never see; bots fill it. */
export function judgeSubmission(input: { website?: string; startedAt?: number }, now: number): SpamVerdict {
  if (input.website) return "honeypot";
  // A form always reports when it was shown; a missing value means the request did not come from the form.
  if (input.startedAt === undefined) return "too_fast";
  return now - input.startedAt < MIN_FILL_MS ? "too_fast" : "ok";
}

export interface RateLimiter {
  /** Returns 0 when the request may proceed, otherwise the seconds to wait. */
  hit(key: string, now: number): number;
}

/** Sliding window per key. In memory: it resets on restart and is per instance, which is fine for a single server. */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return Math.ceil((recent[0] + windowMs - now) / 1000);
      }
      recent.push(now);
      hits.set(key, recent);
      // Drop idle keys so the map cannot grow without bound.
      if (hits.size > 5_000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
      return 0;
    },
  };
}
