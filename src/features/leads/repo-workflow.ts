import { redactSecrets } from "@/features/bitrix/redact";
import type { Db, Row } from "./sql";
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

export async function insertStaff(db: Db, s: Staff & { passwordHash: string }, now = new Date()) {
  await db.run("INSERT INTO staff (id, name, email, role, password_hash, bitrix_user_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
    s.id, s.name, s.email, s.role, s.passwordHash, s.bitrixUserId ?? null, s.active ? 1 : 0, now.toISOString(),
  ]);
}

export const listStaff = async (db: Db): Promise<Staff[]> => (await db.all("SELECT * FROM staff ORDER BY role, name")).map(toStaff);

export const getStaff = async (db: Db, id: string): Promise<Staff | undefined> => {
  const r = await db.get("SELECT * FROM staff WHERE id = ?", [id]);
  return r ? toStaff(r) : undefined;
};

export const countStaff = async (db: Db) => (await db.get("SELECT COUNT(*) AS n FROM staff"))?.n as number;

/** Login lookup: the only place the password hash leaves the table. */
export async function getCredentials(db: Db, email: string): Promise<{ staff: Staff; passwordHash: string } | undefined> {
  const r = await db.get("SELECT * FROM staff WHERE email = ?", [email.trim()]);
  return r ? { staff: toStaff(r), passwordHash: r.password_hash as string } : undefined;
}

export const setStaffActive = async (db: Db, id: string, active: boolean) => (await db.run("UPDATE staff SET active = ? WHERE id = ?", [active ? 1 : 0, id])).changes === 1;

export const setStaffBitrixUser = async (db: Db, id: string, bitrixUserId: number | null) =>
  (await db.run("UPDATE staff SET bitrix_user_id = ? WHERE id = ?", [bitrixUserId, id])).changes === 1;

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

export async function insertTimeline(db: Db, e: TimelineEntry) {
  await db.run("INSERT INTO lead_timeline (id, lead_id, kind, actor_id, actor_name, at, body, from_value, to_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
    e.id, e.leadId, e.kind, e.actorId ?? null, e.actorName, e.at, e.body ?? null, e.from ?? null, e.to ?? null,
  ]);
}

export const listTimeline = async (db: Db, leadId: string): Promise<TimelineEntry[]> =>
  (await db.all("SELECT * FROM lead_timeline WHERE lead_id = ? ORDER BY at DESC, rowid DESC", [leadId])).map(toEntry);

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

export async function enqueueOutbox(db: Db, item: { id: string; leadId: string; kind: OutboxKind; payload: string; createdAt: string }) {
  await db.run("INSERT INTO outbox (id, lead_id, kind, payload, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)", [
    item.id, item.leadId, item.kind, item.payload, item.createdAt,
  ]);
}

export const listOutbox = async (db: Db, leadId: string): Promise<OutboxItem[]> =>
  (await db.all("SELECT * FROM outbox WHERE lead_id = ? ORDER BY created_at DESC, rowid DESC", [leadId])).map(toOutbox);

export const getOutbox = async (db: Db, id: string): Promise<OutboxItem | undefined> => {
  const r = await db.get("SELECT * FROM outbox WHERE id = ?", [id]);
  return r ? toOutbox(r) : undefined;
};

/** Same atomic claim as for leads: only one caller gets to send an item. A stale lock means a crashed attempt. */
export async function claimOutbox(db: Db, id: string, now: string, staleBefore: string): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE outbox SET status = 'sending', locked_at = ?, next_retry_at = NULL
         WHERE id = ? AND (status IN ('pending', 'failed') OR (status = 'sending' AND (locked_at IS NULL OR locked_at < ?)))`,
        [now, id, staleBefore],
      )
    ).changes === 1
  );
}

export async function finishOutbox(
  db: Db,
  id: string,
  r: { status: "done" | "failed" | "pending"; attempts: number; error?: string; code?: string; nextRetryAt?: string; doneAt?: string; demo: boolean },
) {
  await db.run(
    `UPDATE outbox SET status = ?, attempts = ?, last_error = ?, last_error_code = ?, next_retry_at = ?, done_at = ?, locked_at = NULL, demo = ?
     WHERE id = ?`,
    [r.status, r.attempts, r.error ? redactSecrets(r.error) : null, r.code ?? null, r.nextRetryAt ?? null, r.doneAt ?? null, r.demo ? 1 : 0, id],
  );
}

/**
 * Items the worker should send: only for leads Bitrix24 has confirmed (an update needs a Bitrix24 lead ID).
 * Pending items of a lead that has no ID yet simply wait for its first sync.
 */
export async function listDueOutbox(db: Db, now: string, staleBefore: string, limit = 20, leadId?: string): Promise<string[]> {
  const rows = await db.all(
    `SELECT o.id FROM outbox o JOIN leads l ON l.id = o.lead_id
     WHERE l.sync_status = 'synced' AND l.bitrix_lead_id IS NOT NULL
       AND (? IS NULL OR o.lead_id = ?)
       AND (o.status = 'pending'
         OR (o.status = 'failed' AND o.next_retry_at IS NOT NULL AND o.next_retry_at <= ?)
         OR (o.status = 'sending' AND (o.locked_at IS NULL OR o.locked_at < ?)))
     ORDER BY o.created_at, o.rowid LIMIT ?`,
    [leadId ?? null, leadId ?? null, now, staleBefore, limit],
  );
  return rows.map((r) => r.id as string);
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

export const listRules = async (db: Db): Promise<AutomationRule[]> => (await db.all("SELECT * FROM automation_rules ORDER BY position, created_at")).map(toRule);

export const getRule = async (db: Db, id: string): Promise<AutomationRule | undefined> => {
  const r = await db.get("SELECT * FROM automation_rules WHERE id = ?", [id]);
  return r ? toRule(r) : undefined;
};

export async function insertRule(db: Db, r: { id: string; name: string; enabled: boolean; config: RuleConfig; createdAt: string }) {
  const position = (await db.get("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM automation_rules"))?.p as number;
  await db.run("INSERT INTO automation_rules (id, name, enabled, position, config, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    r.id, r.name, r.enabled ? 1 : 0, position, JSON.stringify(r.config), r.createdAt,
  ]);
}

export const setRuleEnabled = async (db: Db, id: string, enabled: boolean) => (await db.run("UPDATE automation_rules SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, id])).changes === 1;

export const setRuleConfig = async (db: Db, id: string, config: RuleConfig) => (await db.run("UPDATE automation_rules SET config = ? WHERE id = ?", [JSON.stringify(config), id])).changes === 1;

export const deleteRule = async (db: Db, id: string) => (await db.run("DELETE FROM automation_rules WHERE id = ?", [id])).changes === 1;

export async function insertAutomationLog(db: Db, e: AutomationLogEntry) {
  await db.run("INSERT INTO automation_log (id, at, rule_id, rule_name, lead_id, lead_name, ok, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
    e.id, e.at, e.ruleId, e.ruleName, e.leadId, e.leadName, e.ok ? 1 : 0, e.message,
  ]);
}

export const listAutomationLog = async (db: Db, limit = 50): Promise<AutomationLogEntry[]> =>
  (await db.all("SELECT * FROM automation_log ORDER BY at DESC, rowid DESC LIMIT ?", [limit])).map((r) => ({
    id: r.id as string,
    at: r.at as string,
    ruleId: r.rule_id as string,
    ruleName: r.rule_name as string,
    leadId: r.lead_id as string,
    leadName: r.lead_name as string,
    ok: r.ok === 1,
    message: r.message as string,
  }));
