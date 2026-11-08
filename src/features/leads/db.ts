import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hashPassword } from "@/features/auth/password";
import { parseMode, type IntegrationMode } from "@/features/bitrix/client";
import { seedDemo } from "@/data/demo";
import { DEFAULT_SETTINGS } from "./defaults";
import { migrate } from "./migrations";
import { insertEvent, insertLead, saveSettings } from "./repo";
import { countStaff, getStaff, insertRule, insertStaff } from "./repo-workflow";
import { createDb, type Db } from "./sql";

export type { Db } from "./sql";

export interface OpenOptions {
  /** Fill an empty database with demo leads, rules and (when `demoPassword` is set) demo managers. Default true. */
  seed?: boolean;
  now?: Date;
  mode?: IntegrationMode;
  /** Password of the first administrator. Without one, no account is created and nobody can sign in. */
  adminPassword?: string;
  /** Password shared by the demo managers; they are created only when this is set. */
  demoPassword?: string;
  /** Token for a remote libSQL server. */
  authToken?: string;
  /** An already connected database (tests use this to run the same suite on Postgres); `url` is then ignored. */
  db?: Db;
}

/** The accounts created on first start: the administrator, and demo managers when a demo password is set. */
export const DEMO_STAFF = [
  { id: "staff-admin", name: "Администратор", email: "admin@example.com", role: "admin", bitrixUserId: 1 },
  { id: "staff-olga", name: "Ольга Смирнова", email: "olga@example.com", role: "manager", bitrixUserId: 11 },
  { id: "staff-denis", name: "Денис Климов", email: "denis@example.com", role: "manager", bitrixUserId: 12 },
  { id: "staff-marina", name: "Марина Егорова", email: "marina@example.com", role: "manager", bitrixUserId: 13 },
] as const;
const STAFF = DEMO_STAFF;

async function seedStaff(db: Db, opts: OpenOptions) {
  // Per account, so that switching the demo on for an existing database adds the demo managers without touching anyone else.
  for (const s of STAFF) {
    const password = s.role === "admin" ? opts.adminPassword : opts.demoPassword;
    if (password && !(await getStaff(db, s.id))) await insertStaff(db, { ...s, active: true, passwordHash: hashPassword(password) });
  }
}

/** First-start content: settings, accounts and (optionally) the demo data. */
async function seedFirstStart(db: Db, opts: OpenOptions) {
  if (!(await db.get("SELECT 1 AS x FROM settings WHERE key = 'integration'"))) {
    await saveSettings(db, { ...DEFAULT_SETTINGS, mode: opts.mode ?? "demo" });
  }
  await seedStaff(db, opts);

  const empty = ((await db.get("SELECT COUNT(*) AS n FROM leads"))?.n as number) === 0;
  if (!empty || opts.seed === false) return;

  const now = opts.now ?? new Date();
  const managerIds = opts.demoPassword ? STAFF.filter((s) => s.role === "manager").map((s) => s.id) : [];
  const demo = seedDemo(now, managerIds);
  await db.tx(async (t) => {
    for (const l of demo.leads) await insertLead(t, l);
    for (const e of demo.events) await insertEvent(t, e);
    if (managerIds.length > 0) {
      await insertRule(t, {
        id: "rule-by-service",
        name: "Интеграции — Ольге, сайты — Денису",
        enabled: true,
        createdAt: now.toISOString(),
        config: { kind: "by_service", assignments: { "crm-integration": "staff-olga", "web-development": "staff-denis" } },
      });
      await insertRule(t, {
        id: "rule-round-robin",
        name: "Остальные заявки по кругу",
        enabled: true,
        createdAt: now.toISOString(),
        config: { kind: "round_robin", staffIds: ["staff-olga", "staff-denis", "staff-marina"] },
      });
    }
  });
}

/**
 * Opens (and creates) a database and brings its schema up to date. `url` is `file:path`, `file::memory:` (an isolated
 * database for tests) a remote libSQL address or `postgres://…`. Several processes may do this at the same time on first start: the one
 * that loses the race finds the work already done.
 */
export async function openDatabase(url: string, opts: OpenOptions = {}): Promise<Db> {
  const file = url.startsWith("file:") && !url.startsWith("file::memory:") ? url.slice("file:".length) : null;
  if (file) mkdirSync(dirname(file), { recursive: true });
  const db = opts.db ?? createDb(url, opts.authToken);
  if (file && !opts.db) {
    // WAL lets the app and a reader (a backup, the e2e checks) use the file at once; the timeout waits out a short lock.
    await db.run("PRAGMA journal_mode = WAL");
    await db.run("PRAGMA busy_timeout = 5000");
  }
  await migrate(db);
  try {
    await seedFirstStart(db, opts);
  } catch (e) {
    // A concurrent first start may have inserted the same rows. If the system is populated now, nothing is missing.
    if ((await countStaff(db)) === 0 && opts.adminPassword) throw e;
  }
  return db;
}

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

/**
 * Where the data lives. `LEADFLOW_DB_URL` is a Postgres address (Supabase) or a libSQL/Turso one (+ `LEADFLOW_DB_TOKEN`);
 * one of them is required on Vercel. Without it a local file is used: `LEADFLOW_DB_PATH`, or `data/leadflow.db`.
 */
export function dbConfig(env: Record<string, string | undefined>): { url: string; authToken?: string } {
  const url = env.LEADFLOW_DB_URL || `file:${env.LEADFLOW_DB_PATH || "data/leadflow.db"}`;
  if (env.VERCEL && url.startsWith("file:")) {
    throw new Error("Vercel has no persistent disk: set LEADFLOW_DB_URL (postgres://… or libsql://… with LEADFLOW_DB_TOKEN).");
  }
  return { url, authToken: env.LEADFLOW_DB_TOKEN || undefined };
}

const g = globalThis as typeof globalThis & { __leadflowDb?: Promise<Db> };

/** Process-wide database. The promise is cached, so concurrent first requests share one start-up; a failed start is retried. */
export function getDb(): Promise<Db> {
  if (!g.__leadflowDb) {
    const { seedDemoData, ...accounts } = accountConfig(process.env);
    const { url, authToken } = dbConfig(process.env);
    g.__leadflowDb = openDatabase(url, { mode: parseMode(process.env.BITRIX24_MODE), seed: seedDemoData, authToken, ...accounts });
    g.__leadflowDb.catch(() => {
      g.__leadflowDb = undefined;
    });
  }
  return g.__leadflowDb;
}
