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
import { processDueRetries, runLeadSync, type SyncDeps } from "./sync-runner";
import type { IntegrationSettings, Lead, RuleConfig } from "./types";

// ---- reads -------------------------------------------------------------------------------------------------------

export const listLeads = (): Lead[] => repo.listLeads(getDb());
export const queryLeads = (q: repo.LeadQuery) => repo.queryLeads(getDb(), q);
export const getLead = (id: string) => repo.getLead(getDb(), id);
export const listEvents = () => repo.listEvents(getDb());
export const queryEvents = (q: repo.EventQuery) => repo.queryEvents(getDb(), q);
export const getEvent = (id: string) => repo.getEvent(getDb(), id);
export const listEventsForLead = (id: string) => repo.listEventsForLead(getDb(), id);
export const getSettings = () => repo.getSettings(getDb());
export const dashboard = (input: Parameters<typeof buildDashboard>[1], now: Date) => buildDashboard(getDb(), input, now);
export const listStaff = () => wf.listStaff(getDb());
export const getStaff = (id: string) => wf.getStaff(getDb(), id);
export const listTimeline = (leadId: string) => wf.listTimeline(getDb(), leadId);
export const listOutbox = (leadId: string) => wf.listOutbox(getDb(), leadId);
export const listRules = () => wf.listRules(getDb());
export const listAutomationLog = (limit?: number) => wf.listAutomationLog(getDb(), limit);

export function saveSettings(patch: Partial<IntegrationSettings>) {
  const next = { ...getSettings(), ...patch };
  repo.saveSettings(getDb(), next);
  return next;
}

export const checkConnection = () => checkIntegration(getSettings().mode);

/** Everything a sync needs, resolved for the mode that is active right now. */
function syncDeps(): SyncDeps & { state: ReturnType<typeof resolveIntegration>["state"] } {
  const settings = getSettings();
  const { client, state } = resolveIntegration(settings.mode);
  return { db: getDb(), client, settings, state };
}

// ---- intake ------------------------------------------------------------------------------------------------------

/**
 * Saves a website lead, then runs the assignment rules on it. Rules run only after the lead is stored, and the lead
 * is returned as it stands afterwards (assigned or not). Sending to Bitrix24 is scheduled by the caller.
 */
export function createLead(data: LeadData, idempotencyKey: string) {
  const db = getDb();
  const { lead, duplicate } = intake.createLead(db, data, idempotencyKey);
  if (duplicate) return { lead, duplicate };
  applyAutomation(db, lead.id);
  return { lead: repo.getLead(db, lead.id) ?? lead, duplicate };
}

export function createManualLead(actor: Actor, data: ManualLeadData, idempotencyKey: string) {
  const db = getDb();
  const r = commands.createManualLead(db, actor, data, idempotencyKey);
  if (r.ok && !r.value.duplicate && !r.value.lead.assigneeId) applyAutomation(db, r.value.lead.id);
  return r;
}

// ---- changes by staff --------------------------------------------------------------------------------------------

export const changeStatus = (actor: Actor, id: string, status: string) => commands.changeStatus(getDb(), actor, id, status);
export const assignLead = (actor: Actor, id: string, staffId: string | null) => commands.assignLead(getDb(), actor, id, staffId);
export const addComment = (actor: Actor, id: string, text: string) => commands.addComment(getDb(), actor, id, text);

// ---- sending to Bitrix24 -----------------------------------------------------------------------------------------

/** Pushes queued changes (status, responsible, comments), for one lead or for everything that is due. */
export async function flushOutbox(leadId?: string): Promise<number> {
  const deps = syncDeps();
  if (deps.state === "misconfigured") return 0;
  return processOutbox(deps, { leadId });
}

/** Sends a lead to the active integration, then the changes that were waiting for it to exist there. */
export async function syncLeadNow(id: string): Promise<Lead | null> {
  const res = await runLeadSync(syncDeps(), id);
  await flushOutbox(id);
  return res.claimed ? res.lead : null;
}

/**
 * Manual retry from the admin panel. A lead that was only "sent" to the demo client can be sent again once live mode is on,
 * because that outcome was simulated.
 */
export async function retrySync(id: string): Promise<Lead | null> {
  const deps = syncDeps();
  const res = await runLeadSync(deps, id, { resendDemo: deps.settings.mode === "live" });
  await flushOutbox(id);
  return res.claimed ? res.lead : null;
}

export async function retryOutboxItem(actor: Actor, itemId: string): Promise<SendResult | { sent: false; reason: string; forbidden: true }> {
  const db = getDb();
  const item = wf.getOutbox(db, itemId);
  const lead = item && repo.getLead(db, item.leadId);
  if (!item || !lead) return { sent: false, reason: "Запись не найдена" };
  if (!canEditLead(actor, lead)) return { sent: false, reason: "Эта заявка закреплена за другим сотрудником", forbidden: true };
  const deps = syncDeps();
  if (deps.state === "misconfigured") return { sent: false, reason: "Боевой режим не настроен: задайте BITRIX24_WEBHOOK_URL" };
  return sendOutboxItem(deps, itemId);
}

/** Background worker entry: automatic retries, skipped while auto-sync is off or live mode is not configured. */
export async function runDueRetries(): Promise<number> {
  const deps = syncDeps();
  if (!deps.settings.autoSync || deps.state === "misconfigured") return 0;
  return (await processDueRetries(deps)) + (await processOutbox(deps));
}

// ---- automation rules and staff (administrators only; the caller checks the role) -------------------------------------

export function createRule(name: string, config: RuleConfig) {
  wf.insertRule(getDb(), { id: commands.newId("rule"), name, enabled: true, config, createdAt: new Date().toISOString() });
}
export const setRuleEnabled = (id: string, enabled: boolean) => wf.setRuleEnabled(getDb(), id, enabled);
export const deleteRule = (id: string) => wf.deleteRule(getDb(), id);

export const setStaffActive = (id: string, active: boolean) => wf.setStaffActive(getDb(), id, active);
export const setStaffBitrixUser = (id: string, bitrixUserId: number | null) => wf.setStaffBitrixUser(getDb(), id, bitrixUserId);
