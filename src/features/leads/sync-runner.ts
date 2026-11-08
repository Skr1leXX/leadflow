import type { DatabaseSync } from "node:sqlite";
import type { BitrixClient } from "@/features/bitrix/client";
import { syncLead } from "@/features/bitrix/sync";
import { claimForSync, finishSync, getLead, listDueForSync } from "./repo";
import { getStaff } from "./repo-workflow";
import type { IntegrationSettings, Lead } from "./types";

/** An attempt that has held the lock this long is assumed to have crashed (the REST call itself times out at 10 s). */
export const STALE_LOCK_MS = 3 * 60_000;
/** A new lead gets this long to be sent by the request that created it before the worker picks it up. */
export const PENDING_GRACE_MS = 2 * 60_000;

export interface SyncDeps {
  db: DatabaseSync;
  client: BitrixClient;
  settings: IntegrationSettings;
  now?: () => Date;
}

export type RunResult = { claimed: false } | { claimed: true; lead: Lead };

/**
 * Sends one lead to Bitrix24 and stores the outcome. Safe to call concurrently: the lead is claimed atomically, so only
 * one caller sends it and the rest get `claimed: false`.
 */
export async function runLeadSync({ db, client, settings, now = () => new Date() }: SyncDeps, id: string, opts: { resendDemo?: boolean } = {}): Promise<RunResult> {
  const t = now();
  const claimed = claimForSync(db, id, t.toISOString(), new Date(t.getTime() - STALE_LOCK_MS).toISOString(), opts.resendDemo);
  if (!claimed) return { claimed: false };

  const lead = getLead(db, id) as Lead;
  const assignee = lead.assigneeId ? getStaff(db, lead.assigneeId) : undefined;
  const { sync, event } = await syncLead(lead, client, settings, { now, assigneeBitrixUserId: assignee?.bitrixUserId });
  finishSync(db, id, sync, event);
  return { claimed: true, lead: { ...lead, sync } };
}

/** Background pass: due retries, leads that never started, and attempts that crashed mid-flight. Returns how many were tried. */
export async function processDueRetries(deps: SyncDeps, limit = 10): Promise<number> {
  const t = (deps.now ?? (() => new Date()))();
  const ids = listDueForSync(
    deps.db,
    t.toISOString(),
    new Date(t.getTime() - PENDING_GRACE_MS).toISOString(),
    new Date(t.getTime() - STALE_LOCK_MS).toISOString(),
    limit,
  );
  let tried = 0;
  for (const id of ids) if ((await runLeadSync(deps, id)).claimed) tried++;
  return tried;
}
