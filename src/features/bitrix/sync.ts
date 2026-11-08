import type { IntegrationSettings, Lead, LeadSync, SyncEvent } from "@/features/leads/types";
import { BitrixError, isRetryable, type BitrixClient } from "./client";
import { toBitrixLead } from "./mapper";

export const MAX_ATTEMPTS = 6;
/** Delay before the next automatic attempt, indexed by attempts made so far (1 -> 1 min, 2 -> 5 min, ...). */
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

export interface SyncOutcome {
  sync: LeadSync;
  event: SyncEvent;
}

export const nextRetryAt = (attempts: number, now: Date): string | undefined =>
  attempts >= MAX_ATTEMPTS ? undefined : new Date(now.getTime() + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1]).toISOString();

/**
 * One sync attempt. Never creates a second lead: it first asks the portal whether this LeadFlow lead already exists
 * (it may, if an earlier attempt succeeded but its answer was lost). Does not touch storage: the caller persists the outcome.
 * A lead counts as synced only when the client returns a lead ID.
 */
export async function syncLead(
  lead: Lead,
  client: BitrixClient,
  settings: IntegrationSettings,
  opts: { now?: () => Date; assigneeBitrixUserId?: number } = {},
): Promise<SyncOutcome> {
  const now = opts.now ?? (() => new Date());
  const started = Date.now();
  const attempt = lead.sync.attempts + 1;
  const prefix = client.demo ? "Демо: " : "";
  const event = { id: `ev-${lead.id}-${attempt}-${started}`, leadId: lead.id, leadName: lead.name, method: "crm.lead.add", attempt, demo: client.demo };

  try {
    const existing = await client.findLeadByOrigin(lead.id);
    const id = existing ?? (await client.createLead(toBitrixLead(lead, settings, opts.assigneeBitrixUserId))).id;
    const message = existing ? `Лид уже есть в Битрикс24, ID ${id}: дубль не создан` : `Лид создан, ID ${id}`;
    const at = now().toISOString();
    return {
      sync: { status: "synced", bitrixId: id, attempts: attempt, lastAttemptAt: at, demo: client.demo },
      event: { ...event, at, ok: true, bitrixId: id, message: prefix + message, durationMs: Date.now() - started },
    };
  } catch (e) {
    const code = e instanceof BitrixError ? e.code : "UNKNOWN";
    const message = e instanceof BitrixError ? e.message : "Неизвестная ошибка обмена";
    const at = now();
    return {
      sync: {
        status: "failed",
        attempts: attempt,
        lastAttemptAt: at.toISOString(),
        lastError: prefix + message,
        lastErrorCode: code,
        nextRetryAt: isRetryable(code) ? nextRetryAt(attempt, at) : undefined,
        demo: client.demo,
      },
      event: { ...event, at: at.toISOString(), ok: false, errorCode: code, message: prefix + message, durationMs: Date.now() - started },
    };
  }
}
