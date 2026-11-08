import { test, expect } from "./fixtures";
import { AUTH, E2E, createLead, dbAll, forceMode, leadRow, waitForSyncStatus } from "./helpers";

// Live mode against a portal that does not exist (the host ends in .invalid): every call fails, which is what we want. It shows
// how real errors are stored and displayed, and that the webhook's secret code never leaks into them. Runs last and always
// switches back to demo mode, even when it fails.

test.use({ storageState: AUTH.admin });
test.describe.configure({ mode: "serial" });
test.afterAll(() => forceMode("demo"));

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const noSecrets = (text: string) => {
  for (const s of [E2E.webhookCode, E2E.webhookUrl, E2E.apiToken, E2E.sessionSecret]) expect(text).not.toContain(s);
};

test("the administrator switches to live mode and the page stops calling itself a demo", async ({ page }) => {
  await page.goto("/admin/integration");
  await page.getByRole("button", { name: "Боевой" }).click();
  await expect(page.getByText("Включён боевой режим")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Боевой режим", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("leak-test.invalid").first()).toBeVisible();
  await expect(page.getByText("Демонстрационный режим: заявки не уходят")).toHaveCount(0);
  noSecrets(await page.content());
});

test("checking the connection reports the portal as unreachable without leaking the webhook", async ({ page }) => {
  await page.goto("/admin/integration");
  await page.getByRole("button", { name: "Проверить соединение" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Не удалось подключиться" });
  await expect(alert).toBeVisible({ timeout: 30_000 }); // an unresolvable host can take several seconds to fail
  await expect(alert).toContainText(/PORTAL_UNREACHABLE|TIMEOUT/);
  noSecrets(await alert.innerText());
  noSecrets(await page.content());
});

test("a lead submitted in live mode is saved, the portal error is stored, shown and secret-free, and a retry is possible", async ({ page, request }) => {
  const { id, body } = await createLead(request);
  await waitForSyncStatus(id, "failed");
  const row = leadRow(id)!;
  expect(["PORTAL_UNREACHABLE", "TIMEOUT"]).toContain(row.sync_error_code);
  expect(row).toMatchObject({ sync_demo: 0, bitrix_lead_id: null, status: "new" });
  noSecrets(String(row.sync_error));

  await page.goto(`/admin/leads/${id}`);
  await expect(page.getByText(body.name).first()).toBeVisible();
  await expect(page.getByText(/PORTAL_UNREACHABLE|TIMEOUT/).first()).toBeVisible();
  await expect(page.getByText("демо", { exact: true })).toHaveCount(0); // a real attempt is never labelled as a demo
  noSecrets(await page.content());

  await page.getByRole("button", { name: "Повторить отправку", exact: true }).click();
  await expect.poll(() => leadRow(id)?.sync_attempts).toBe(2);
  noSecrets(String(leadRow(id)?.sync_error));

  await page.goto(`/admin/sync-log?lead=${id}`);
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await expect(page.getByText("Боевой: ответ настоящего портала")).toBeVisible();
  noSecrets(await page.content());

  for (const t of dbAll("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'staff'").map((r) => r.name as string)) {
    noSecrets(JSON.stringify(dbAll(`SELECT * FROM ${t}`)));
  }
});

test("a change made in live mode stays queued locally and is never pushed to a demo lead ID", async ({ page, request }) => {
  const { id } = await createLead(request);
  await waitForSyncStatus(id, "failed");
  await page.goto(`/admin/leads/${id}`);
  await page.locator("#lead-status").selectOption("in_progress");
  await expect(page.getByText("Статус обновлён")).toBeVisible();
  expect(leadRow(id)?.status).toBe("in_progress");
  const queued = dbAll("SELECT status FROM outbox WHERE lead_id = ?", id);
  expect(queued.map((o) => o.status)).toEqual(["pending"]);
  await expect(page.getByText("Уйдёт после создания лида в Битрикс24")).toBeVisible();
});

test("the Bitrix24 API requires the token in live mode and answers without secrets", async ({ request }) => {
  for (const [method, path] of [["get", "/api/bitrix/status"], ["post", "/api/bitrix/check"], ["post", "/api/bitrix/call"], ["post", "/api/sync/run"]] as const) {
    const none = await request[method](path);
    expect(none.status(), `${path} without a token`).toBe(401);
    const wrong = await request[method](path, { headers: bearer("wrong-token-value") });
    expect(wrong.status(), `${path} with a wrong token`).toBe(401);
    noSecrets(await none.text());
  }

  const status = await request.get("/api/bitrix/status", { headers: bearer(E2E.apiToken) });
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({ ok: true, mode: "live", state: "ready", host: "leak-test.invalid", webhookConfigured: true });

  const check = await request.post("/api/bitrix/check", { headers: bearer(E2E.apiToken) });
  expect(check.status()).toBe(502);
  const report = await check.json();
  expect(report.ok).toBe(false);
  expect(["PORTAL_UNREACHABLE", "TIMEOUT"]).toContain(report.error.code);
  noSecrets(JSON.stringify(report));

  const denied = await request.post("/api/bitrix/call", { headers: bearer(E2E.apiToken), data: { method: "crm.lead.delete", params: { id: 1 } } });
  expect(denied.status()).toBe(400);
  expect((await denied.json()).allowed).toContain("profile");
  const allowed = await request.post("/api/bitrix/call", { headers: bearer(E2E.apiToken), data: { method: "profile" } });
  expect([502, 504], "unreachable is 502, a timeout is 504").toContain(allowed.status());
  noSecrets(await allowed.text());
});

test("switching back to demo mode works from the page", async ({ page }) => {
  await page.goto("/admin/integration");
  await page.getByRole("button", { name: "Демо" }).click();
  await expect(page.getByText("Включён демонстрационный режим")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Демонстрационный режим: заявки не уходят")).toBeVisible();
});
