import { createHash } from "node:crypto";
import type { Db } from "./sql";

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

/** Counters hold a client address or an e-mail, so only a hash of the key is stored. */
const keyHash = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32);

/**
 * Sliding-window request counter kept in the database, so that it holds across server restarts and across the many
 * instances serverless hosting runs. Returns 0 when the request may proceed, otherwise the seconds to wait. Under heavy
 * parallel load it may let a request or two through before the count catches up: it throttles, it is not a hard guarantee.
 */
export async function rateLimitHit(db: Db, key: string, limit: number, windowMs: number, now = Date.now()): Promise<number> {
  const k = keyHash(key);
  const wait = await db.tx(async (t) => {
    await t.run("DELETE FROM rate_limits WHERE key = ? AND at <= ?", [k, now - windowMs]);
    const hits = await t.all("SELECT at FROM rate_limits WHERE key = ? ORDER BY at", [k]);
    if (hits.length >= limit) return Math.ceil((Number(hits[0].at) + windowMs - now) / 1000);
    await t.run("INSERT INTO rate_limits (key, at) VALUES (?, ?)", [k, now]);
    return 0;
  });
  // Housekeeping: now and then drop counters of keys that went quiet long ago.
  if (Math.random() < 0.02) await db.run("DELETE FROM rate_limits WHERE at < ?", [now - 24 * 3_600_000]);
  return wait;
}
