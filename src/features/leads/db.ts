import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "@/features/auth/password";
import { parseMode, type IntegrationMode } from "@/features/bitrix/client";
import { seedDemo } from "@/data/demo";
import { DEFAULT_SETTINGS } from "./defaults";
import { migrate } from "./migrations";
import { insertEvent, insertLead, saveSettings } from "./repo";
import { countStaff, insertRule, insertStaff } from "./repo-workflow";

export interface OpenOptions {
  /** Fill an empty database with demo leads, rules and (when `demoPassword` is set) demo managers. Default true. */
  seed?: boolean;
  now?: Date;
  mode?: IntegrationMode;
  /** Password of the first administrator. Without one, no account is created and nobody can sign in. */
  adminPassword?: string;
  /** Password shared by the demo managers; they are created only when this is set. */
  demoPassword?: string;
}

/** The accounts created on first start: the administrator, and demo managers when a demo password is set. */
export const DEMO_STAFF = [
  { id: "staff-admin", name: "Администратор", email: "admin@example.com", role: "admin", bitrixUserId: 1 },
  { id: "staff-olga", name: "Ольга Смирнова", email: "olga@example.com", role: "manager", bitrixUserId: 11 },
  { id: "staff-denis", name: "Денис Климов", email: "denis@example.com", role: "manager", bitrixUserId: 12 },
  { id: "staff-marina", name: "Марина Егорова", email: "marina@example.com", role: "manager", bitrixUserId: 13 },
] as const;
const STAFF = DEMO_STAFF;

function seedStaff(db: DatabaseSync, opts: OpenOptions) {
  if (countStaff(db) > 0) return;
  for (const s of STAFF) {
    const password = s.role === "admin" ? opts.adminPassword : opts.demoPassword;
    if (password) insertStaff(db, { ...s, active: true, passwordHash: hashPassword(password) });
  }
}

/** Opens (and creates) a database and brings its schema up to date. `:memory:` gives an isolated one for tests. */
export function openDatabase(path: string, opts: OpenOptions = {}): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  migrate(db);

  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'integration'").get()) {
    saveSettings(db, { ...DEFAULT_SETTINGS, mode: opts.mode ?? "demo" });
  }
  seedStaff(db, opts);

  const empty = (db.prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number }).n === 0;
  if (empty && opts.seed !== false) {
    const now = opts.now ?? new Date();
    const managerIds = opts.demoPassword ? STAFF.filter((s) => s.role === "manager").map((s) => s.id) : [];
    const demo = seedDemo(now, managerIds);
    db.exec("BEGIN");
    for (const l of demo.leads) insertLead(db, l);
    for (const e of demo.events) insertEvent(db, e);
    if (managerIds.length > 0) {
      insertRule(db, {
        id: "rule-by-service",
        name: "Интеграции — Ольге, сайты — Денису",
        enabled: true,
        createdAt: now.toISOString(),
        config: { kind: "by_service", assignments: { "crm-integration": "staff-olga", "web-development": "staff-denis" } },
      });
      insertRule(db, {
        id: "rule-round-robin",
        name: "Остальные заявки по кругу",
        enabled: true,
        createdAt: now.toISOString(),
        config: { kind: "round_robin", staffIds: ["staff-olga", "staff-denis", "staff-marina"] },
      });
    }
    db.exec("COMMIT");
  }
  return db;
}

const g = globalThis as typeof globalThis & { __leadflowDb?: DatabaseSync };

export interface AccountConfig {
  adminPassword?: string;
  demoPassword?: string;
  /** Fill an empty database with the fictional demo leads. Never on a normal production start. */
  seedDemoData: boolean;
  /** The login page may list the demo accounts and their password. Only ever in development or by explicit opt-in. */
  showDemoLogins: boolean;
}

/**
 * Who can sign in on first start, derived from the environment.
 * - Development: everything works out of the box with the password "leadflow-demo".
 * - Production: nothing is created except an administrator whose password comes from LEADFLOW_ADMIN_PASSWORD, and the
 *   database starts empty. LEADFLOW_DEMO=true opts in to fictional leads and, with LEADFLOW_DEMO_PASSWORD, demo managers.
 */
export function accountConfig(env: Record<string, string | undefined>): AccountConfig {
  const prod = env.NODE_ENV === "production";
  const demo = !prod || env.LEADFLOW_DEMO === "true";
  const adminPassword = env.LEADFLOW_ADMIN_PASSWORD || (prod ? undefined : "leadflow-demo");
  const demoPassword = demo ? env.LEADFLOW_DEMO_PASSWORD || (prod ? undefined : "leadflow-demo") : undefined;
  return {
    adminPassword,
    demoPassword,
    seedDemoData: demo,
    showDemoLogins: demoPassword !== undefined && (!prod || env.LEADFLOW_SHOW_DEMO_LOGINS === "true"),
  };
}

/** Process-wide database; the path can be overridden with LEADFLOW_DB_PATH. */
export function getDb(): DatabaseSync {
  if (!g.__leadflowDb) {
    const { seedDemoData, ...accounts } = accountConfig(process.env);
    g.__leadflowDb = openDatabase(process.env.LEADFLOW_DB_PATH || "data/leadflow.db", { mode: parseMode(process.env.BITRIX24_MODE), seed: seedDemoData, ...accounts });
  }
  return g.__leadflowDb;
}
