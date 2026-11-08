const MASK = "***";

/** Env variables whose values must never reach the journal, even if a portal or a library echoes them back. */
const SECRET_ENV = ["BITRIX24_WEBHOOK_URL", "LEADFLOW_API_TOKEN", "LEADFLOW_SESSION_SECRET", "LEADFLOW_ADMIN_PASSWORD", "LEADFLOW_DEMO_PASSWORD"] as const;

/** The secret part of an env value: for a webhook URL its access code, otherwise the whole value. */
function secretPart(name: string, value: string): string | null {
  if (name === "BITRIX24_WEBHOOK_URL") return /\/rest\/\d+\/([A-Za-z0-9]+)/.exec(value)?.[1] ?? null;
  return value.length >= 6 ? value : null;
}

/**
 * Removes secrets from text before it is stored in the sync journal or shown in the admin panel: webhook access codes,
 * bearer tokens, `token=`/`auth=`/`password=` pairs, and any configured secret that appears verbatim.
 */
export function redactSecrets(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text
    .replace(/(\/rest\/\d+\/)[A-Za-z0-9]{6,}/g, `$1${MASK}`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, `Bearer ${MASK}`)
    .replace(/\b((?:access_|refresh_)?token|auth|password|passwd|secret|api[_-]?key)("?\s*[=:]\s*"?)[^\s"&,;]{3,}/gi, `$1$2${MASK}`);
  for (const name of SECRET_ENV) {
    const part = env[name] ? secretPart(name, env[name] as string) : null;
    if (part) out = out.split(part).join(MASK);
  }
  return out;
}
