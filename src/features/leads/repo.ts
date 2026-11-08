import { redactSecrets } from "@/features/bitrix/redact";
import { DEFAULT_SETTINGS } from "./defaults";
import { dayStartIso } from "@/lib/format";
import { searchTerms, searchText } from "./search";
import type { Arg, Db, Row } from "./sql";
import { LEAD_STATUSES, type IntegrationSettings, type Lead, type LeadStatus, type LeadSync, type SyncEvent } from "./types";

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

export async function insertLead(db: Db, l: Lead, keys: { idempotencyKey?: string; fingerprint?: string } = {}) {
  await db.run(
    `INSERT INTO leads (id, name, phone, email, service_id, comment, status, created_at, source, idempotency_key, fingerprint,
       sync_status, sync_attempts, sync_last_attempt_at, sync_error, sync_error_code, sync_next_retry_at, sync_demo, bitrix_lead_id,
       assignee_id, search, demo_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      l.id, l.name, l.phone, l.email, l.serviceId, l.comment, l.status, l.createdAt, l.source,
      keys.idempotencyKey ?? null, keys.fingerprint ?? null,
      l.sync.status, l.sync.attempts, l.sync.lastAttemptAt ?? null, l.sync.lastError ? redactSecrets(l.sync.lastError) : null, l.sync.lastErrorCode ?? null,
      l.sync.nextRetryAt ?? null, l.sync.demo ? 1 : 0, l.sync.bitrixId ?? null,
      l.assigneeId ?? null, searchText(l), l.demoData ? 1 : 0,
    ],
  );
}

export async function insertEvent(db: Db, e: SyncEvent) {
  await db.run(
    `INSERT INTO sync_events (id, lead_id, lead_name, at, method, attempt, ok, bitrix_id, error_code, message, duration_ms, demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.id, e.leadId, e.leadName, e.at, e.method, e.attempt, e.ok ? 1 : 0, e.bitrixId ?? null, e.errorCode ?? null, redactSecrets(e.message), e.durationMs, e.demo ? 1 : 0],
  );
}

export const getLead = async (db: Db, id: string) => {
  const r = await db.get("SELECT * FROM leads WHERE id = ?", [id]);
  return r ? toLead(r) : undefined;
};

export const listLeads = async (db: Db): Promise<Lead[]> => (await db.all("SELECT * FROM leads ORDER BY created_at DESC")).map(toLead);

export const listEvents = async (db: Db): Promise<SyncEvent[]> => (await db.all("SELECT * FROM sync_events ORDER BY at DESC")).map(toEvent);

export const listEventsForLead = async (db: Db, leadId: string): Promise<SyncEvent[]> =>
  (await db.all("SELECT * FROM sync_events WHERE lead_id = ? ORDER BY at DESC", [leadId])).map(toEvent);

export const findByIdempotencyKey = async (db: Db, key: string) => {
  const r = await db.get("SELECT * FROM leads WHERE idempotency_key = ?", [key]);
  return r ? toLead(r) : undefined;
};

/** Same submission content within the window, e.g. a double click that produced two different keys. */
export const findRecentByFingerprint = async (db: Db, fingerprint: string, sinceIso: string) => {
  const r = await db.get("SELECT * FROM leads WHERE fingerprint = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1", [fingerprint, sinceIso]);
  return r ? toLead(r) : undefined;
};

export async function setStatus(db: Db, id: string, status: LeadStatus) {
  return (await db.run("UPDATE leads SET status = ? WHERE id = ?", [status, id])).changes === 1;
}

/**
 * Atomically takes a lead for sending. Returns false when another attempt already holds it, which is what stops two
 * parallel retries from both calling Bitrix24. A lock older than `staleBefore` is treated as a crashed attempt.
 * `resendDemo` also allows leads that were only "sent" to the demo client.
 */
export async function claimForSync(db: Db, id: string, now: string, staleBefore: string, resendDemo = false): Promise<boolean> {
  const res = await db.run(
    `UPDATE leads SET sync_status = 'sending', sync_locked_at = ?, sync_next_retry_at = NULL
     WHERE id = ? AND (
       sync_status IN ('pending', 'failed')
       OR (sync_status = 'sending' AND (sync_locked_at IS NULL OR sync_locked_at < ?))
       OR (? = 1 AND sync_status = 'synced' AND sync_demo = 1)
     )`,
    [now, id, staleBefore, resendDemo ? 1 : 0],
  );
  return res.changes === 1;
}

/** Stores the outcome of an attempt and its journal entry together. */
export async function finishSync(db: Db, id: string, sync: LeadSync, event: SyncEvent) {
  await db.tx(async (t) => {
    await t.run(
      `UPDATE leads SET sync_status = ?, sync_attempts = ?, sync_last_attempt_at = ?, sync_error = ?, sync_error_code = ?,
         sync_next_retry_at = ?, sync_locked_at = NULL, sync_demo = ?, bitrix_lead_id = ? WHERE id = ?`,
      [
        sync.status, sync.attempts, sync.lastAttemptAt ?? null, sync.lastError ? redactSecrets(sync.lastError) : null, sync.lastErrorCode ?? null,
        sync.nextRetryAt ?? null, sync.demo ? 1 : 0, sync.bitrixId ?? null, id,
      ],
    );
    await insertEvent(t, event);
  });
}

/** Leads the background worker should (re)send: due retries, pending leads that never started, and crashed attempts. */
export async function listDueForSync(db: Db, now: string, pendingBefore: string, staleBefore: string, limit = 10): Promise<string[]> {
  const rows = await db.all(
    `SELECT id FROM leads WHERE
       (sync_status = 'failed' AND sync_next_retry_at IS NOT NULL AND sync_next_retry_at <= ?)
       OR (sync_status = 'pending' AND created_at <= ?)
       OR (sync_status = 'sending' AND (sync_locked_at IS NULL OR sync_locked_at < ?))
     ORDER BY created_at LIMIT ?`,
    [now, pendingBefore, staleBefore, limit],
  );
  return rows.map((r) => r.id as string);
}

export async function getSettings(db: Db): Promise<IntegrationSettings> {
  const r = await db.get("SELECT value FROM settings WHERE key = 'integration'");
  const stored = JSON.parse(r?.value as string) as Partial<IntegrationSettings>;
  // Settings saved by older versions lack newer keys, so fill them from the defaults.
  return { ...DEFAULT_SETTINGS, ...stored, statusMap: { ...DEFAULT_SETTINGS.statusMap, ...stored.statusMap } };
}

export async function saveSettings(db: Db, s: IntegrationSettings) {
  await db.run("INSERT INTO settings (key, value) VALUES ('integration', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(s)]);
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
export async function queryLeads(db: Db, q: LeadQuery): Promise<{ rows: Lead[]; total: number; page: number; pages: number }> {
  const where: string[] = [];
  const args: Arg[] = [];

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
  const total = (await db.get(`SELECT COUNT(*) AS n FROM leads ${clause}`, args))?.n as number;

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
  const rows = (await db.all(`SELECT * FROM leads ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [...args, size, (page - 1) * size])).map(toLead);
  return { rows, total, page, pages };
}

export async function assignLead(db: Db, id: string, staffId: string | null) {
  return (await db.run("UPDATE leads SET assignee_id = ? WHERE id = ?", [staffId, id])).changes === 1;
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
export async function queryEvents(db: Db, q: EventQuery): Promise<{ rows: SyncEvent[]; total: number; page: number; pages: number }> {
  const where: string[] = [];
  const args: Arg[] = [];
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
  const total = (await db.get(`SELECT COUNT(*) AS n FROM sync_events ${clause}`, args))?.n as number;
  const size = q.pageSize ?? EVENT_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(q.page ?? 1) || 1), pages);
  const rows = (await db.all(`SELECT * FROM sync_events ${clause} ORDER BY at DESC, rowid DESC LIMIT ? OFFSET ?`, [...args, size, (page - 1) * size])).map(toEvent);
  return { rows, total, page, pages };
}

export const getEvent = async (db: Db, id: string) => {
  const r = await db.get("SELECT * FROM sync_events WHERE id = ?", [id]);
  return r ? toEvent(r) : undefined;
};

// ---- analytics queries -------------------------------------------------------------------------------------------

/** Leads created on the given Moscow days (inclusive). `includeDemo` false drops the fictional seed leads. */
export async function leadRowsInRange(db: Db, from: string, to: string, includeDemo: boolean) {
  const rows = await db.all(
    `SELECT created_at, status, source, service_id, demo_data FROM leads WHERE created_at >= ? AND created_at < ? ${includeDemo ? "" : "AND demo_data = 0"}`,
    [dayStart(from), dayStart(to, 1)],
  );
  return rows.map((r) => ({
    createdAt: r.created_at as string,
    status: r.status as LeadStatus,
    source: r.source as string,
    serviceId: r.service_id as string,
    demoData: r.demo_data === 1,
  }));
}

export async function countLeadsInRange(db: Db, from: string, to: string, includeDemo: boolean): Promise<number> {
  const r = await db.get(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND created_at < ? ${includeDemo ? "" : "AND demo_data = 0"}`, [dayStart(from), dayStart(to, 1)]);
  return r?.n as number;
}
