import { newId } from "./commands";
import * as repo from "./repo";
import * as wf from "./repo-workflow";
import type { Db } from "./sql";
import type { AutomationRule, Lead, RuleConfig, Staff } from "./types";

export interface Choice {
  staffId: string;
  /** Updated rule config to store together with the assignment (the round-robin cursor). */
  nextConfig?: RuleConfig;
}

/** Decides who a rule would assign the lead to; null when the rule has nobody suitable. Pure: nothing is saved here. */
export function pickAssignee(rule: AutomationRule, lead: Pick<Lead, "serviceId">, staff: Staff[]): Choice | null {
  const active = new Set(staff.filter((s) => s.active).map((s) => s.id));
  const c = rule.config;

  if (c.kind === "by_service") {
    const id = c.assignments[lead.serviceId] ?? c.fallbackStaffId;
    return id && active.has(id) ? { staffId: id } : null;
  }

  const candidates = c.staffIds.filter((id) => active.has(id));
  if (candidates.length === 0) return null;
  const last = c.lastStaffId ? candidates.indexOf(c.lastStaffId) : -1;
  const next = candidates[(last + 1) % candidates.length];
  return { staffId: next, nextConfig: { ...c, lastStaffId: next } };
}

export interface AutomationResult {
  ruleId: string;
  ruleName: string;
  staffId: string;
}

/**
 * Runs the enabled rules on a freshly saved, still unassigned lead; the first rule that picks someone wins.
 * The assignment, its history entry, the log entry and the Bitrix24 queue item are written in one transaction, so
 * nothing is recorded as done unless the assignment itself was saved. An already assigned lead is left alone.
 */
export async function applyAutomation(db: Db, leadId: string, now = new Date()): Promise<AutomationResult | null> {
  const lead = await repo.getLead(db, leadId);
  if (!lead || lead.assigneeId) return null;
  const staff = await wf.listStaff(db);

  for (const rule of await wf.listRules(db)) {
    if (!rule.enabled) continue;
    const pick = pickAssignee(rule, lead, staff);
    if (!pick) continue;
    const target = staff.find((s) => s.id === pick.staffId) as Staff;
    const at = now.toISOString();

    try {
      const done = await db.tx(async (t) => {
        // Only an unassigned lead is taken: if a person assigned it meanwhile, the rule backs off.
        const claimed = (await t.run("UPDATE leads SET assignee_id = ? WHERE id = ? AND assignee_id IS NULL", [target.id, leadId])).changes === 1;
        if (!claimed) return false;
        await wf.insertTimeline(t, { id: newId("tl"), leadId, kind: "automation", actorName: "Автоматизация", at, body: rule.name, from: "не назначен", to: target.name });
        if (pick.nextConfig) await wf.setRuleConfig(t, rule.id, pick.nextConfig);
        await wf.insertAutomationLog(t, { id: newId("al"), at, ruleId: rule.id, ruleName: rule.name, leadId, leadName: lead.name, ok: true, message: `Ответственный: ${target.name}` });
        await wf.enqueueOutbox(t, { id: newId("ob"), leadId, kind: "assignee", payload: target.id, createdAt: at });
        return true;
      });
      return done ? { ruleId: rule.id, ruleName: rule.name, staffId: target.id } : null;
    } catch (e) {
      // The transaction rolled back, so nothing above happened; keep a record of the failed attempt.
      await wf.insertAutomationLog(db, { id: newId("al"), at, ruleId: rule.id, ruleName: rule.name, leadId, leadName: lead.name, ok: false, message: `Не удалось назначить: ${e instanceof Error ? e.message : "ошибка"}` });
      return null;
    }
  }
  return null;
}
