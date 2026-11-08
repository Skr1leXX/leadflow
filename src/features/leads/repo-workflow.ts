import type { DatabaseSync } from "node:sqlite";
import { redactSecrets } from "@/features/bitrix/redact";
import type {
  AutomationLogEntry,
  AutomationRule,
  OutboxItem,
  OutboxKind,
  OutboxStatus,
  Role,
  RuleConfig,
  Staff,
  TimelineEntry,
} from "./types";

type Row = Record<string, unknown>;
const opt = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));

// ---- staff -------------------------------------------------------------------------------------------------------

const toStaff = (r: Row): Staff => ({
  id: r.id as string,
  name: r.name as string,
  email: r.email as string,
  role: r.role as Role,
  active: r.active === 1,
  bitrixUserId: opt(r.bitrix_user_id),
});

export function insertStaff(db: DatabaseSync, s: Staff & { passwordHash: string }, now = new Date()) {
  db.prepare("INSERT INTO staff (id, name, email, role, password_hash, bitrix_user_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    s.id, s.name, s.email, s.role, s.passwordHash, s.bitrixUserId ?? null, s.active ? 1 : 0, now.toISOString(),
  );
}

export const listStaff = (db: DatabaseSync): Staff[] => db.prepare("SELECT * FROM staff ORDER BY role, name").all().map(toStaff);

export const getStaff = (db: DatabaseSync, id: string): Staff | undefined => {
  const r = db.prepare("SELECT * FROM staff WHERE id = ?").get(id);
  return r ? toStaff(r) : undefined;
};

export const countStaff = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) AS n FROM staff").get() as { n: number }).n;

/** Login lookup: the only place the password hash leaves the table. */
export function getCredentials(db: DatabaseSync, email: string): { staff: Staff; passwordHash: string } | undefined {
  const r = db.prepare("SELECT * FROM staff WHERE email = ?").get(email.trim());
  return r ? { staff: toStaff(r), passwordHash: r.password_hash as string } : undefined;
}

export const setStaffActive = (db: DatabaseSync, id: string, active: boolean) =>
  db.prepare("UPDATE staff SET active = ? WHERE id = ?").run(active ? 1 : 0, id).changes === 1;

export const setStaffBitrixUser = (db: DatabaseSync, id: string, bitrixUserId: number | null) =>
  db.prepare("UPDATE staff SET bitrix_user_id = ? WHERE id = ?").run(bitrixUserId, id).changes === 1;

// ---- timeline ----------------------------------------------------------------------------------------------------

const toEntry = (r: Row): TimelineEntry => ({
  id: r.id as string,
  leadId: r.lead_id as string,
  kind: r.kind as TimelineEntry["kind"],
  actorId: opt(r.actor_id),
  actorName: r.actor_name as string,
  at: r.at as string,
  body: opt(r.body),
  from: opt(r.from_value),
  to: opt(r.to_value),
});

export function insertTimeline(db: DatabaseSync, e: TimelineEntry) {
  db.prepare("INSERT INTO lead_timeline (id, lead_id, kind, actor_id, actor_name, at, body, from_value, to_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    e.id, e.leadId, e.kind, e.actorId ?? null, e.actorName, e.at, e.body ?? null, e.from ?? null, e.to ?? null,
  );
}

export const listTimeline = (db: DatabaseSync, leadId: string): TimelineEntry[] =>
  db.prepare("SELECT * FROM lead_timeline WHERE lead_id = ? ORDER BY at DESC, rowid DESC").all(leadId).map(toEntry);

// ---- outbox ------------------------------------------------------------------------------------------------------

const toOutbox = (r: Row): OutboxItem => ({
  id: r.id as string,
  leadId: r.lead_id as string,
  kind: r.kind as OutboxKind,
  payload: r.payload as string,
  status: r.status as OutboxStatus,
  attempts: r.attempts as number,
  lastError: opt(r.last_error),
  lastErrorCode: opt(r.last_error_code),
  nextRetryAt: opt(r.next_retry_at),
  createdAt: r.created_at as string,
  doneAt: opt(r.done_at),
  demo: r.demo === 1,
});

export function enqueueOutbox(db: DatabaseSync, item: { id: string; leadId: string; kind: OutboxKind; payload: string; createdAt: string }) {
  db.prepare("INSERT INTO outbox (id, lead_id, kind, payload, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").run(
    item.id, item.leadId, item.kind, item.payload, item.createdAt,
  );
}

export const listOutbox = (db: DatabaseSync, leadId: string): OutboxItem[] =>
  db.prepare("SELECT * FROM outbox WHERE lead_id = ? ORDER BY created_at DESC, rowid DESC").all(leadId).map(toOutbox);

export const getOutbox = (db: DatabaseSync, id: string): OutboxItem | undefined => {
  const r = db.prepare("SELECT * FROM outbox WHERE id = ?").get(id);
  return r ? toOutbox(r) : undefined;
};

/** Same atomic claim as for leads: only one caller gets to send an item. A stale lock means a crashed attempt. */
export function claimOutbox(db: DatabaseSync, id: string, now: string, staleBefore: string): boolean {
  return (
    db
      .prepare(
        `UPDATE outbox SET status = 'sending', locked_at = ?, next_retry_at = NULL
         WHERE id = ? AND (status IN ('pending', 'failed') OR (status = 'sending' AND (locked_at IS NULL OR locked_at < ?)))`,
      )
      .run(now, id, staleBefore).changes === 1
  );
}

export function finishOutbox(
  db: DatabaseSync,
  id: string,
  r: { status: "done" | "failed" | "pending"; attempts: number; error?: string; code?: string; nextRetryAt?: string; doneAt?: string; demo: boolean },
) {
  db.prepare(
    `UPDATE outbox SET status = ?, attempts = ?, last_error = ?, last_error_code = ?, next_retry_at = ?, done_at = ?, locked_at = NULL, demo = ?
     WHERE id = ?`,
  ).run(r.status, r.attempts, r.error ? redactSecrets(r.error) : null, r.code ?? null, r.nextRetryAt ?? null, r.doneAt ?? null, r.demo ? 1 : 0, id);
}

/**
 * Items the worker should send: only for leads Bitrix24 has confirmed (an update needs a Bitrix24 lead ID).
 * Pending items of a lead that has no ID yet simply wait for its first sync.
 */
export function listDueOutbox(db: DatabaseSync, now: string, staleBefore: string, limit = 20, leadId?: string): string[] {
  return db
    .prepare(
      `SELECT o.id FROM outbox o JOIN leads l ON l.id = o.lead_id
       WHERE l.sync_status = 'synced' AND l.bitrix_lead_id IS NOT NULL
         AND (? IS NULL OR o.lead_id = ?)
         AND (o.status = 'pending'
           OR (o.status = 'failed' AND o.next_retry_at IS NOT NULL AND o.next_retry_at <= ?)
           OR (o.status = 'sending' AND (o.locked_at IS NULL OR o.locked_at < ?)))
       ORDER BY o.created_at, o.rowid LIMIT ?`,
    )
    .all(leadId ?? null, leadId ?? null, now, staleBefore, limit)
    .map((r) => r.id as string);
}

// ---- automation --------------------------------------------------------------------------------------------------

const toRule = (r: Row): AutomationRule => ({
  id: r.id as string,
  name: r.name as string,
  enabled: r.enabled === 1,
  position: r.position as number,
  config: JSON.parse(r.config as string) as RuleConfig,
  createdAt: r.created_at as string,
});

export const listRules = (db: DatabaseSync): AutomationRule[] => db.prepare("SELECT * FROM automation_rules ORDER BY position, created_at").all().map(toRule);

export const getRule = (db: DatabaseSync, id: string): AutomationRule | undefined => {
  const r = db.prepare("SELECT * FROM automation_rules WHERE id = ?").get(id);
  return r ? toRule(r) : undefined;
};

export function insertRule(db: DatabaseSync, r: { id: string; name: string; enabled: boolean; config: RuleConfig; createdAt: string }) {
  const position = (db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM automation_rules").get() as { p: number }).p;
  db.prepare("INSERT INTO automation_rules (id, name, enabled, position, config, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    r.id, r.name, r.enabled ? 1 : 0, position, JSON.stringify(r.config), r.createdAt,
  );
}

export const setRuleEnabled = (db: DatabaseSync, id: string, enabled: boolean) =>
  db.prepare("UPDATE automation_rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id).changes === 1;

export const setRuleConfig = (db: DatabaseSync, id: string, config: RuleConfig) =>
  db.prepare("UPDATE automation_rules SET config = ? WHERE id = ?").run(JSON.stringify(config), id).changes === 1;

export const deleteRule = (db: DatabaseSync, id: string) => db.prepare("DELETE FROM automation_rules WHERE id = ?").run(id).changes === 1;

export function insertAutomationLog(db: DatabaseSync, e: AutomationLogEntry) {
  db.prepare("INSERT INTO automation_log (id, at, rule_id, rule_name, lead_id, lead_name, ok, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    e.id, e.at, e.ruleId, e.ruleName, e.leadId, e.leadName, e.ok ? 1 : 0, e.message,
  );
}

export const listAutomationLog = (db: DatabaseSync, limit = 50): AutomationLogEntry[] =>
  db
    .prepare("SELECT * FROM automation_log ORDER BY at DESC, rowid DESC LIMIT ?")
    .all(limit)
    .map((r) => ({
      id: r.id as string,
      at: r.at as string,
      ruleId: r.rule_id as string,
      ruleName: r.rule_name as string,
      leadId: r.lead_id as string,
      leadName: r.lead_name as string,
      ok: r.ok === 1,
      message: r.message as string,
    }));
