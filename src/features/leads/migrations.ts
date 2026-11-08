import type { DatabaseSync } from "node:sqlite";
import { searchText } from "./search";

interface Migration {
  id: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

const V1 = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  service_id TEXT NOT NULL,
  comment TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  fingerprint TEXT,
  sync_status TEXT NOT NULL,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  sync_last_attempt_at TEXT,
  sync_error TEXT,
  sync_error_code TEXT,
  sync_next_retry_at TEXT,
  sync_locked_at TEXT,
  sync_demo INTEGER NOT NULL DEFAULT 0,
  bitrix_lead_id INTEGER
);
CREATE INDEX IF NOT EXISTS leads_created ON leads (created_at);
CREATE INDEX IF NOT EXISTS leads_sync ON leads (sync_status, sync_next_retry_at);
CREATE INDEX IF NOT EXISTS leads_fingerprint ON leads (fingerprint, created_at);

CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  lead_name TEXT NOT NULL,
  at TEXT NOT NULL,
  method TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  bitrix_id INTEGER,
  error_code TEXT,
  message TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_lead ON sync_events (lead_id, at);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const V2 = `
ALTER TABLE leads ADD COLUMN assignee_id TEXT;
ALTER TABLE leads ADD COLUMN search TEXT NOT NULL DEFAULT '';
-- "processed" became "won" ("successfully completed") when the status list grew to five.
UPDATE leads SET status = 'won' WHERE status = 'processed';
CREATE INDEX leads_assignee ON leads (assignee_id);
CREATE INDEX leads_status ON leads (status);

CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  bitrix_user_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE lead_timeline (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  at TEXT NOT NULL,
  body TEXT,
  from_value TEXT,
  to_value TEXT
);
CREATE INDEX timeline_lead ON lead_timeline (lead_id, at);

-- Changes made in LeadFlow that must reach Bitrix24; kept apart from leads so a failed push never blocks local work.
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_error_code TEXT,
  next_retry_at TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL,
  done_at TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX outbox_lead ON outbox (lead_id, created_at);
CREATE INDEX outbox_due ON outbox (status, next_retry_at);

CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE automation_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  lead_name TEXT NOT NULL,
  ok INTEGER NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX automation_log_at ON automation_log (at);
`;

const V3 = `
ALTER TABLE leads ADD COLUMN demo_data INTEGER NOT NULL DEFAULT 0;
-- Leads written by the demo seed have ids like lead-001; real ones get random hex ids.
UPDATE leads SET demo_data = 1 WHERE id GLOB 'lead-[0-9][0-9][0-9]';
CREATE INDEX leads_demo_created ON leads (demo_data, created_at);
`;

export const MIGRATIONS: Migration[] = [
  { id: 1, name: "leads, sync journal, settings", up: (db) => db.exec(V1) },
  {
    id: 2,
    name: "staff, timeline, outbox, automation; five lead statuses; list search",
    up: (db) => {
      db.exec(V2);
      const rows = db.prepare("SELECT id, name, email, phone FROM leads").all() as { id: string; name: string; email: string; phone: string }[];
      const set = db.prepare("UPDATE leads SET search = ? WHERE id = ?");
      for (const r of rows) set.run(searchText(r), r.id);
    },
  },
  { id: 3, name: "demo data flag for analytics", up: (db) => db.exec(V3) },
];

/** Applies pending migrations in order, each in its own transaction, and records them. Safe to run on every start. */
export function migrate(db: DatabaseSync): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const done = new Set((db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec("BEGIN");
    try {
      m.up(db);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, new Date().toISOString());
      db.exec("COMMIT");
      applied.push(m.id);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return applied;
}
