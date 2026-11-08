import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { E2E } from "../playwright.config";

export { E2E };

export const MANAGER_A = { name: "Анна Менеджер", email: "anna@e2e.test" };
export const MANAGER_B = { name: "Борис Менеджер", email: "boris@e2e.test" };
export const AUTH = { admin: "e2e/.auth/admin.json", anna: "e2e/.auth/anna.json", boris: "e2e/.auth/boris.json" } as const;

let counter = 0;
/** Short unique token for names and emails, so tests never collide on the shared database. */
export const uniq = () => `${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
/** A fresh client address for the rate limiter (it keys on x-forwarded-for). */
export const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

// ---- database (read-only checks, plus one write helper for cleanup) ---------------------------------------------------

export function db<T>(fn: (d: DatabaseSync) => T, readOnly = true): T {
  const d = new DatabaseSync(E2E.dbPath, { readOnly });
  try {
    d.exec("PRAGMA busy_timeout = 5000");
    return fn(d);
  } finally {
    d.close();
  }
}
export const dbAll = (sql: string, ...args: SQLInputValue[]) => db((d) => d.prepare(sql).all(...args)) as Record<string, unknown>[];
export const dbGet = (sql: string, ...args: SQLInputValue[]) => db((d) => d.prepare(sql).get(...args)) as Record<string, unknown> | undefined;

export const leadRow = (id: string) => dbGet("SELECT * FROM leads WHERE id = ?", id);
export const leadsByEmail = (email: string) => dbAll("SELECT * FROM leads WHERE email = ?", email);

/** Waits for the background send to finish and returns the final sync status. */
export async function waitForSyncStatus(id: string, status: "synced" | "failed", timeout = 20_000) {
  await expect.poll(() => leadRow(id)?.sync_status, { timeout, message: `lead ${id} sync status` }).toBe(status);
}

/** Resets the integration mode without the UI: cleanup must work even when a test failed half-way. */
export function forceMode(mode: "demo" | "live") {
  db((d) => {
    const cur = JSON.parse((d.prepare("SELECT value FROM settings WHERE key = 'integration'").get() as { value: string }).value);
    d.prepare("UPDATE settings SET value = ? WHERE key = 'integration'").run(JSON.stringify({ ...cur, mode }));
  }, false);
}

// ---- API and UI helpers ------------------------------------------------------------------------------------------

export interface LeadBody {
  name: string;
  phone: string;
  email: string;
  serviceId: string;
  comment: string;
  idempotencyKey: string;
  startedAt: number;
  [k: string]: unknown;
}

export function leadBody(over: Partial<LeadBody> = {}): LeadBody {
  const n = uniq();
  return { name: `Тест ${n}`, phone: "+7 900 123-45-67", email: `t${n}@example.com`, serviceId: "automation", comment: `e2e ${n}`, idempotencyKey: `e2e-${n}-abcdefgh`, startedAt: Date.now() - 10_000, ...over };
}

/** Posts a lead the way the form does and returns the parsed answer. */
export async function postLead(request: APIRequestContext, over: Partial<LeadBody> = {}, ip = randomIp()) {
  const body = leadBody(over);
  const res = await request.post("/api/leads", { data: body, headers: { "x-forwarded-for": ip } });
  return { res, body, json: (await res.json().catch(() => null)) as { ok?: boolean; id?: string; duplicate?: boolean; message?: string; errors?: Record<string, string> } | null };
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
}

/** True when the page scrolls sideways, i.e. something is wider than the viewport. */
export const hasHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

/** Creates a lead through the API, waits until it is saved and returns its ID. */
export async function createLead(request: APIRequestContext, over: Partial<LeadBody> = {}) {
  const { res, body, json } = await postLead(request, over);
  expect(res.status(), "lead created").toBe(201);
  return { id: json!.id as string, body };
}
