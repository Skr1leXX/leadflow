import { checkIntegration, resolveIntegration } from "@/features/bitrix/integration";
import type { Actor } from "@/features/auth/permissions";
import { canEditLead } from "@/features/auth/permissions";
import { buildDashboard } from "@/features/dashboard/analytics";
import { applyAutomation } from "./automation";
import * as commands from "./commands";
import { getDb } from "./db";
import * as intake from "./intake";
import { processOutbox, sendOutboxItem, type SendResult } from "./outbox";
import * as repo from "./repo";
import * as wf from "./repo-workflow";
import type { LeadData, ManualLeadData } from "./schema";
import { rateLimitHit } from "./spam";
import { processDueRetries, runLeadSync, type SyncDeps } from "./sync-runner";
import type { IntegrationSettings, Lead, RuleConfig } from "./types";

// ---- reads -------------------------------------------------------------------------------------------------------

export const listLeads = async (): Promise<Lead[]> => repo.listLeads(await getDb());
export const queryLeads = async (q: repo.LeadQuery) => repo.queryLeads(await getDb(), q);
export const getLead = async (id: string) => repo.getLead(await getDb(), id);
export const listEvents = async () => repo.listEvents(await getDb());
export const queryEvents = async (q: repo.EventQuery) => repo.queryEvents(await getDb(), q);
export const getEvent = async (id: string) => repo.getEvent(await getDb(), id);
export const listEventsForLead = async (id: string) => repo.listEventsForLead(await getDb(), id);
export const getSettings = async () => repo.getSettings(await getDb());
export const dashboard = async (input: Parameters<typeof buildDashboard>[1], now: Date) => buildDashboard(await getDb(), input, now);
export const listStaff = async () => wf.listStaff(await getDb());
export const getStaff = async (id: string) => wf.getStaff(await getDb(), id);
export const listTimeline = async (leadId: string) => wf.listTimeline(await getDb(), leadId);
export const listOutbox = async (leadId: string) => wf.listOutbox(await getDb(), leadId);
export const listRules = async () => wf.listRules(await getDb());
export const listAutomationLog = async (limit?: number) => wf.listAutomationLog(await getDb(), limit);

export async function saveSettings(patch: Partial<IntegrationSettings>) {
  const db = await getDb();
  const next = { ...(await repo.getSettings(db)), ...patch };
  await repo.saveSettings(db, next);
  return next;
}

export const checkConnection = async () => {
  const db = await getDb();
  return checkIntegration((await repo.getSettings(db)).mode, db);
};

/** Request counter shared by every instance of the app: at most `limit` hits per `windowMs` for one key. Returns seconds to wait, or 0. */
export const rateLimit = async (key: string, limit: number, windowMs: number) => rateLimitHit(await getDb(), key, limit, windowMs);

/** Everything a sync needs, resolved for the mode that is active right now. */
async function syncDeps(): Promise<SyncDeps & { state: ReturnType<typeof resolveIntegration>["state"] }> {
  const db = await getDb();
  const settings = await repo.getSettings(db);
  const { client, state } = resolveIntegration(settings.mode, db);
  return { db, client, settings, state };
}

// ---- intake ------------------------------------------------------------------------------------------------------

/**
 * Saves a website lead, then runs the assignment rules on it. Rules run only after the lead is stored, and the lead
 * is returned as it stands afterwards (assigned or not). Sending to Bitrix24 is scheduled by the caller.
 */
export async function createLead(data: LeadData, idempotencyKey: string) {
  const db = await getDb();
  const { lead, duplicate } = await intake.createLead(db, data, idempotencyKey);
  if (duplicate) return { lead, duplicate };
  await applyAutomation(db, lead.id);
  return { lead: (await repo.getLead(db, lead.id)) ?? lead, duplicate };
}

export async function createManualLead(actor: Actor, data: ManualLeadData, idempotencyKey: string) {
  const db = await getDb();
  const r = await commands.createManualLead(db, actor, data, idempotencyKey);
  if (r.ok && !r.value.duplicate && !r.value.lead.assigneeId) await applyAutomation(db, r.value.lead.id);
  return r;
}

// ---- changes by staff --------------------------------------------------------------------------------------------

export const changeStatus = async (actor: Actor, id: string, status: string) => commands.changeStatus(await getDb(), actor, id, status);
export const assignLead = async (actor: Actor, id: string, staffId: string | null) => commands.assignLead(await getDb(), actor, id, staffId);
export const addComment = async (actor: Actor, id: string, text: string) => commands.addComment(await getDb(), actor, id, text);

// ---- sending to Bitrix24 -----------------------------------------------------------------------------------------

/** Pushes queued changes (status, responsible, comments), for one lead or for everything that is due. */
export async function flushOutbox(leadId?: string): Promise<number> {
  const deps = await syncDeps();
  if (deps.state === "misconfigured") return 0;
  return processOutbox(deps, { leadId });
}

/** Sends a lead to the active integration, then the changes that were waiting for it to exist there. */
export async function syncLeadNow(id: string): Promise<Lead | null> {
  const res = await runLeadSync(await syncDeps(), id);
  await flushOutbox(id);
  return res.claimed ? res.lead : null;
}

/**
 * Manual retry from the admin panel. A lead that was only "sent" to the demo client can be sent again once live mode is on,
 * because that outcome was simulated.
 */
export async function retrySync(id: string): Promise<Lead | null> {
  const deps = await syncDeps();
  const res = await runLeadSync(deps, id, { resendDemo: deps.settings.mode === "live" });
  await flushOutbox(id);
  return res.claimed ? res.lead : null;
}

export async function retryOutboxItem(actor: Actor, itemId: string): Promise<SendResult | { sent: false; reason: string; forbidden: true }> {
  const db = await getDb();
  const item = await wf.getOutbox(db, itemId);
  const lead = item && (await repo.getLead(db, item.leadId));
  if (!item || !lead) return { sent: false, reason: "Запись не найдена" };
  if (!canEditLead(actor, lead)) return { sent: false, reason: "Эта заявка закреплена за другим сотрудником", forbidden: true };
  const deps = await syncDeps();
  if (deps.state === "misconfigured") return { sent: false, reason: "Боевой режим не настроен: задайте BITRIX24_WEBHOOK_URL" };
  return sendOutboxItem(deps, itemId);
}

/**
 * Retry pass: leads and queued changes that are due. Run by the in-process worker on a normal server, and by
 * `/api/sync/run` (a cron job) on serverless hosting. Skipped while auto-sync is off or live mode is not configured.
 */
export async function runDueRetries(): Promise<number> {
  const deps = await syncDeps();
  if (!deps.settings.autoSync || deps.state === "misconfigured") return 0;
  return (await processDueRetries(deps)) + (await processOutbox(deps));
}

// ---- automation rules and staff (administrators only; the caller checks the role) -------------------------------------

export async function createRule(name: string, config: RuleConfig) {
  await wf.insertRule(await getDb(), { id: commands.newId("rule"), name, enabled: true, config, createdAt: new Date().toISOString() });
}
export const setRuleEnabled = async (id: string, enabled: boolean) => wf.setRuleEnabled(await getDb(), id, enabled);
export const deleteRule = async (id: string) => wf.deleteRule(await getDb(), id);

export const setStaffActive = async (id: string, active: boolean) => wf.setStaffActive(await getDb(), id, active);
export const setStaffBitrixUser = async (id: string, bitrixUserId: number | null) => wf.setStaffBitrixUser(await getDb(), id, bitrixUserId);
