import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "lf_session";
export const SESSION_TTL_MS = 8 * 3_600_000;

interface Payload {
  /** Staff ID. */
  sid: string;
  /** Expiry, epoch ms. */
  exp: number;
}

/**
 * Epoch milliseconds without `Date.now()`. Next.js refuses `Date.now()` while a page may be prerendered, which in production
 * threw during the session check and sent signed-in users back to the login page. The session check is request-time by nature.
 */
const epochNow = () => Math.floor(performance.timeOrigin + performance.now());

const mac = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

/** "<base64url payload>.<hmac>": tamper-evident, not encrypted, so it carries nothing but the staff ID. */
export function signSession(staffId: string, secret: string, now = epochNow()): string {
  const body = Buffer.from(JSON.stringify({ sid: staffId, exp: now + SESSION_TTL_MS } satisfies Payload)).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/** Returns the staff ID for a genuine, unexpired token; null otherwise. Callers must still check the staff member is active. */
export function verifySession(token: string | undefined, secret: string, now?: number): string | null {
  // The clock is read only once there is a token to check: a request without one must not depend on time (it may be prerendered).
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    return typeof p.sid === "string" && typeof p.exp === "number" && p.exp > (now ?? epochNow()) ? p.sid : null;
  } catch {
    return null;
  }
}
