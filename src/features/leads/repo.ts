import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { redactSecrets } from "@/features/bitrix/redact";
import { DEFAULT_SETTINGS } from "./defaults";
import { dayStartIso } from "@/lib/format";
import { searchTerms, searchText } from "./search";
import { LEAD_STATUSES, type IntegrationSettings, type Lead, type LeadStatus, type LeadSync, type SyncEvent } from "./types";

type Row = Record<string, unknown>;

const bool = (v: unknown) => v === 1;
const opt = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));

function toLead(r: Row): Lead {
  return {
    id: r.id as string,
    name: r.name as string,
    phone: r.phone as string,
    email: r.email as string,
    serviceId: r.service_id as string,
    comment: r.comment as string,
    status: r.status as LeadStatus,
    assigneeId: opt(r.assignee_id),
    createdAt: r.created_at as string,
    source: r.source as Lead["source"],
    demoData: bool(r.demo_data),
    sync: {
      status: r.sync_status as LeadSync["status"],
      attempts: r.sync_attempts as number,
      bitrixId: opt(r.bitrix_lead_id),
      lastAttemptAt: opt(r.sync_last_attempt_at),
      lastError: opt(r.sync_error),
      lastErrorCode: opt(r.sync_error_code),
      nextRetryAt: opt(r.sync_next_retry_at),
      demo: bool(r.sync_demo),
    },
  };
}

function toEvent(r: Row): SyncEvent {
  return {
    id: r.id as string,
    leadId: r.lead_id as string,
    leadName: r.lead_name as string,
    at: r.at as string,
    method: r.method as string,
    attempt: r.attempt as number,
    ok: bool(r.ok),
    bitrixId: opt(r.bitrix_id),
    errorCode: opt(r.error_code),
    message: r.message as string,
    durationMs: r.duration_ms as number,
    demo: bool(r.demo),
  };
}

export function insertLead(db: DatabaseSync, l: Lead, keys: { idempotencyKey?: string; fingerprint?: string } = {}) {
  db.prepare(
    `INSERT INTO leads (id, name, phone, email, service_id, comment, status, created_at, source, idempotency_key, fingerprint,
       sync_status, sync_attempts, sync_last_attempt_at, sync_error, sync_error_code, sync_next_retry_at, sync_demo, bitrix_lead_id,
       assignee_id, search, demo_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    l.id, l.name, l.phone, l.email, l.serviceId, l.comment, l.status, l.createdAt, l.source,
    keys.idempotencyKey ?? null, keys.fingerprint ?? null,
    l.sync.status, l.sync.attempts, l.sync.lastAttemptAt ?? null, l.sync.lastError ? redactSecrets(l.sync.lastError) : null, l.sync.lastErrorCode ?? null,
    l.sync.nextRetryAt ?? null, l.sync.demo ? 1 : 0, l.sync.bitrixId ?? null,
    l.assigneeId ?? null, searchText(l), l.demoData ? 1 : 0,
  );
}

export function insertEvent(db: DatabaseSync, e: SyncEvent) {
  db.prepare(
    `INSERT INTO sync_events (id, lead_id, lead_name, at, method, attempt, ok, bitrix_id, error_code, message, duration_ms, demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(e.id, e.leadId, e.leadName, e.at, e.method, e.attempt, e.ok ? 1 : 0, e.bitrixId ?? null, e.errorCode ?? null, redactSecrets(e.message), e.durationMs, e.demo ? 1 : 0);
}

export const getLead = (db: DatabaseSync, id: string) => {
  const r = db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
  return r ? toLead(r) : undefined;
};

export const listLeads = (db: DatabaseSync): Lead[] =>
  db.prepare("SELECT * FROM leads ORDER BY created_at DESC").all().map(toLead);

export const listEvents = (db: DatabaseSync): SyncEvent[] =>
  db.prepare("SELECT * FROM sync_events ORDER BY at DESC").all().map(toEvent);

export const listEventsForLead = (db: DatabaseSync, leadId: string): SyncEvent[] =>
  db.prepare("SELECT * FROM sync_events WHERE lead_id = ? ORDER BY at DESC").all(leadId).map(toEvent);

export const findByIdempotencyKey = (db: DatabaseSync, key: string) => {
  const r = db.prepare("SELECT * FROM leads WHERE idempotency_key = ?").get(key);
  return r ? toLead(r) : undefined;
};

/** Same submission content within the window, e.g. a double click that produced two different keys. */
export const findRecentByFingerprint = (db: DatabaseSync, fingerprint: string, sinceIso: string) => {
  const r = db.prepare("SELECT * FROM leads WHERE fingerprint = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1").get(fingerprint, sinceIso);
  return r ? toLead(r) : undefined;
};

export function setStatus(db: DatabaseSync, id: string, status: LeadStatus) {
  return db.prepare("UPDATE leads SET status = ? WHERE id = ?").run(status, id).changes === 1;
}

/**
 * Atomically takes a lead for sending. Returns false when another attempt already holds it, which is what stops two
 * parallel retries from both calling Bitrix24. A lock older than `staleBefore` is treated as a crashed attempt.
 * `resendDemo` also allows leads that were only "sent" to the demo client.
 */
export function claimForSync(db: DatabaseSync, id: string, now: string, staleBefore: string, resendDemo = false): boolean {
  const res = db
    .prepare(
      `UPDATE leads SET sync_status = 'sending', sync_locked_at = ?, sync_next_retry_at = NULL
       WHERE id = ? AND (
         sync_status IN ('pending', 'failed')
         OR (sync_status = 'sending' AND (sync_locked_at IS NULL OR sync_locked_at < ?))
         OR (? = 1 AND sync_status = 'synced' AND sync_demo = 1)
       )`,
    )
    .run(now, id, staleBefore, resendDemo ? 1 : 0);
  return res.changes === 1;
}

/** Stores the outcome of an attempt and its journal entry together. */
export function finishSync(db: DatabaseSync, id: string, sync: LeadSync, event: SyncEvent) {
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE leads SET sync_status = ?, sync_attempts = ?, sync_last_attempt_at = ?, sync_error = ?, sync_error_code = ?,
         sync_next_retry_at = ?, sync_locked_at = NULL, sync_demo = ?, bitrix_lead_id = ? WHERE id = ?`,
    ).run(
      sync.status, sync.attempts, sync.lastAttemptAt ?? null, sync.lastError ? redactSecrets(sync.lastError) : null, sync.lastErrorCode ?? null,
      sync.nextRetryAt ?? null, sync.demo ? 1 : 0, sync.bitrixId ?? null, id,
    );
    insertEvent(db, event);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Leads the background worker should (re)send: due retries, pending leads that never started, and crashed attempts. */
export function listDueForSync(db: DatabaseSync, now: string, pendingBefore: string, staleBefore: string, limit = 10): string[] {
  const args: SQLInputValue[] = [now, pendingBefore, staleBefore, limit];
  return db
    .prepare(
      `SELECT id FROM leads WHERE
         (sync_status = 'failed' AND sync_next_retry_at IS NOT NULL AND sync_next_retry_at <= ?)
         OR (sync_status = 'pending' AND created_at <= ?)
         OR (sync_status = 'sending' AND (sync_locked_at IS NULL OR sync_locked_at < ?))
       ORDER BY created_at LIMIT ?`,
    )
    .all(...args)
    .map((r) => r.id as string);
}

export function getSettings(db: DatabaseSync): IntegrationSettings {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'integration'").get();
  const stored = JSON.parse(r?.value as string) as Partial<IntegrationSettings>;
  // Settings saved by older versions lack newer keys, so fill them from the defaults.
  return { ...DEFAULT_SETTINGS, ...stored, statusMap: { ...DEFAULT_SETTINGS.statusMap, ...stored.statusMap } };
}

export function saveSettings(db: DatabaseSync, s: IntegrationSettings) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('integration', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(s));
}

export const LEAD_SORTS = ["created", "name", "status"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export interface LeadQuery {
  q?: string;
  status?: string;
  source?: string;
  /** A staff ID, or "none" for unassigned leads. */
  assignee?: string;
  /** Inclusive dates, "YYYY-MM-DD", in the app time zone. */
  from?: string;
  to?: string;
  sort?: LeadSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export const PAGE_SIZE = 15;

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = dayStartIso;

/** Filtered, sorted, paged lead list. Every value is whitelisted or bound as a parameter. */
export function queryLeads(db: DatabaseSync, q: LeadQuery): { rows: Lead[]; total: number; page: number; pages: number } {
  const where: string[] = [];
  const args: SQLInputValue[] = [];

  for (const term of searchTerms(q.q ?? "")) {
    where.push("search LIKE ? ESCAPE '\\'");
    args.push(`%${term.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (q.status && (LEAD_STATUSES as readonly string[]).includes(q.status)) {
    where.push("status = ?");
    args.push(q.status);
  }
  if (q.source === "website" || q.source === "manual") {
    where.push("source = ?");
    args.push(q.source);
  }
  if (q.assignee === "none") where.push("assignee_id IS NULL");
  else if (q.assignee) {
    where.push("assignee_id = ?");
    args.push(q.assignee);
  }
  if (q.from && DAY_RE.test(q.from)) {
    where.push("created_at >= ?");
    args.push(dayStart(q.from));
  }
  if (q.to && DAY_RE.test(q.to)) {
    where.push("created_at < ?");
    args.push(dayStart(q.to, 1));
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM leads ${clause}`).get(...args) as { n: number }).n;

  const sort = q.sort && (LEAD_SORTS as readonly string[]).includes(q.sort) ? q.sort : "created";
  const dir = q.dir === "asc" ? "ASC" : "DESC";
  const order = {
    created: `created_at ${dir}`,
    name: `name COLLATE NOCASE ${dir}, created_at DESC`,
    status: `CASE status ${LEAD_STATUSES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} END ${dir}, created_at DESC`,
  }[sort];

  const size = q.pageSize ?? PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(q.page ?? 1) || 1), pages);
  const rows = db
    .prepare(`SELECT * FROM leads ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, size, (page - 1) * size)
    .map(toLead);
  return { rows, total, page, pages };
}

export function assignLead(db: DatabaseSync, id: string, staffId: string | null) {
  return db.prepare("UPDATE leads SET assignee_id = ? WHERE id = ?").run(staffId, id).changes === 1;
}

// ---- sync journal ------------------------------------------------------------------------------------------------

/** Operation types in the journal: Bitrix24 REST methods LeadFlow calls. */
export const EVENT_TYPES = ["crm.lead.add", "crm.lead.update", "crm.timeline.comment.add"] as const;

export interface EventQuery {
  /** Inclusive dates, "YYYY-MM-DD", in the app time zone. */
  from?: string;
  to?: string;
  status?: string;
  type?: string;
  /** Local lead ID. */
  lead?: string;
  page?: number;
  pageSize?: number;
}

export const EVENT_PAGE_SIZE = 20;

/** Filtered, paged journal, newest first. Every value is whitelisted or bound as a parameter. */
export function queryEvents(db: DatabaseSync, q: EventQuery): { rows: SyncEvent[]; total: number; page: number; pages: number } {
  const where: string[] = [];
  const args: SQLInputValue[] = [];
  if (q.from && DAY_RE.test(q.from)) {
    where.push("at >= ?");
    args.push(dayStart(q.from));
  }
  if (q.to && DAY_RE.test(q.to)) {
    where.push("at < ?");
    args.push(dayStart(q.to, 1));
  }
  if (q.status === "ok" || q.status === "error") where.push(q.status === "ok" ? "ok = 1" : "ok = 0");
  if (q.type && (EVENT_TYPES as readonly string[]).includes(q.type)) {
    where.push("method = ?");
    args.push(q.type);
  }
  if (q.lead && /^[\w-]{1,60}$/.test(q.lead)) {
    where.push("lead_id = ?");
    args.push(q.lead);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM sync_events ${clause}`).get(...args) as { n: number }).n;
  const size = q.pageSize ?? EVENT_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(q.page ?? 1) || 1), pages);
  const rows = db
    .prepare(`SELECT * FROM sync_events ${clause} ORDER BY at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (page - 1) * size)
    .map(toEvent);
  return { rows, total, page, pages };
}

export const getEvent = (db: DatabaseSync, id: string) => {
  const r = db.prepare("SELECT * FROM sync_events WHERE id = ?").get(id);
  return r ? toEvent(r) : undefined;
};

// ---- analytics queries -------------------------------------------------------------------------------------------

/** Leads created on the given Moscow days (inclusive). `includeDemo` false drops the fictional seed leads. */
export function leadRowsInRange(db: DatabaseSync, from: string, to: string, includeDemo: boolean) {
  return db
    .prepare(`SELECT created_at, status, source, service_id, demo_data FROM leads WHERE created_at >= ? AND created_at < ? ${includeDemo ? "" : "AND demo_data = 0"}`)
    .all(dayStart(from), dayStart(to, 1))
    .map((r) => ({
      createdAt: r.created_at as string,
      status: r.status as LeadStatus,
      source: r.source as string,
      serviceId: r.service_id as string,
      demoData: r.demo_data === 1,
    }));
}

export function countLeadsInRange(db: DatabaseSync, from: string, to: string, includeDemo: boolean): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND created_at < ? ${includeDemo ? "" : "AND demo_data = 0"}`)
      .get(dayStart(from), dayStart(to, 1)) as { n: number }
  ).n;
}
