import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";
import { AUTH, E2E, MANAGER_A, createLead, db, dbAll } from "./helpers";

test.use({ storageState: AUTH.admin });

/** Values that must never reach a browser, a log, the journal or the database. */
const SECRETS = [E2E.webhookCode, E2E.webhookUrl, E2E.apiToken, E2E.sessionSecret, E2E.adminPassword, E2E.managerPassword];

const leaks = (text: string) => SECRETS.filter((s) => text.includes(s));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test.describe("no secrets reach the client", () => {
  test("pages and their data payloads contain no secret values", async ({ page, request }) => {
    const { id } = await createLead(request);
    const paths = ["/", "/login", "/admin", "/admin/leads", `/admin/leads/${id}`, "/admin/leads/new", "/admin/integration", "/admin/settings", "/admin/sync-log", "/admin/staff", "/admin/automation", "/admin/clients"];
    for (const path of paths) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await page.waitForLoadState("networkidle");
      expect(leaks(await page.content()), `rendered ${path}`).toEqual([]);
      // the same page fetched as raw HTML carries the embedded RSC payload as well
      const raw = await page.context().request.get(path);
      expect(leaks(await raw.text()), `raw ${path}`).toEqual([]);
    }
  });

  test("the integration page says a webhook is set without showing it, and settings never ask for it", async ({ page }) => {
    await page.goto("/admin/integration");
    await expect(page.getByText("Задан (значение скрыто)")).toBeVisible();
    await expect(page.getByText("Не задан", { exact: true })).toHaveCount(0);
    await page.goto("/admin/settings");
    await expect(page.locator("input[name=webhookUrl]")).toHaveCount(0);
    await expect(page.getByText("Адрес вебхука задаётся только в .env.local")).toBeVisible();
  });

  test("the connection check answers the browser without any secret", async ({ page }) => {
    await page.goto("/admin/integration");
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (r.request().method() === "POST") bodies.push(await r.text().catch(() => ""));
    });
    await page.getByRole("button", { name: "Проверить соединение" }).click();
    await expect(page.getByText("Демо-ответ получен")).toBeVisible();
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(leaks(b)).toEqual([]);
  });

  test("the built client bundles contain no secret value", async () => {
    const files = walk(".next/static").filter((f) => /\.(js|css|map|json|html|txt)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    const found = files.flatMap((f) => {
      const text = readFileSync(f, "utf8");
      return leaks(text).map((s) => `${f}: ${s.slice(0, 6)}…`);
    });
    expect(found).toEqual([]);
  });

  test("staff data shown to administrators never includes password hashes", async ({ page }) => {
    await page.goto("/admin/staff");
    await expect(page.getByText(MANAGER_A.email)).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("scrypt$");
    const raw = await (await page.context().request.get("/admin/staff")).text();
    expect(raw).not.toContain("scrypt$");
    expect(raw).not.toContain("password_hash");
  });

  test("the journal, lead errors and the outbox in the database hold no secret", async ({ request }) => {
    await createLead(request, { email: `sec-${Date.now()}@bitrix-error.test` });
    const tables = db((d) => (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name));
    for (const t of tables.filter((n) => n !== "staff")) {
      const text = JSON.stringify(dbAll(`SELECT * FROM ${t}`));
      expect(leaks(text), `table ${t}`).toEqual([]);
    }
  });
});
