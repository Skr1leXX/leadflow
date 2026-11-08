import "server-only";
import { parseMode, type IntegrationMode } from "./client";
import { WEBHOOK_PATTERN } from "./real-client";

export interface BitrixEnv {
  /** The secret. Only server modules may read it; never put it in a prop, action result or API response. */
  webhookUrl: string | null;
  /** Variable is set but not a valid https://<portal>/rest/<id>/<code>/ URL. */
  invalid: boolean;
  /** Portal host taken from the webhook URL; the one safe-to-show part. */
  host: string | null;
  /** Mode LeadFlow starts in. Anything but BITRIX24_MODE=live means demo. */
  defaultMode: IntegrationMode;
}

export function readBitrixEnv(env: NodeJS.ProcessEnv = process.env): BitrixEnv {
  const raw = env.BITRIX24_WEBHOOK_URL?.trim() || null;
  const valid = raw !== null && WEBHOOK_PATTERN.test(raw);
  return {
    webhookUrl: valid ? raw : null,
    invalid: raw !== null && !valid,
    host: valid ? new URL(raw).host : null,
    defaultMode: parseMode(env.BITRIX24_MODE),
  };
}
