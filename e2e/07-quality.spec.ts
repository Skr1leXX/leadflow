import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { AUTH, createLead, hasHorizontalScroll, waitForSyncStatus } from "./helpers";

test.use({ storageState: AUTH.admin });

test.describe("operations: health, headers, icon", () => {
  test("the health endpoint reports liveness and reveals nothing else", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers()["cache-control"]).toContain("no-store");
  });

  test("responses carry security headers and no framework banner", async ({ request }) => {
    for (const path of ["/", "/login", "/api/health"]) {
      const h = (await request.get(path)).headers();
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"], path).toContain("camera=()");
      expect(h["x-powered-by"], path).toBeUndefined();
    }
  });

  test("signed-in pages are never cacheable by shared caches", async ({ page }) => {
    for (const path of ["/admin", "/admin/leads", "/login"]) {
      const res = await page.goto(path);
      expect(res?.headers()["cache-control"], path).toContain("no-store");
    }
  });

  test("the app has its own icon, not a framework default", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator("link[rel~=icon]").first()).toHaveAttribute("href", /icon/);
    const icon = await request.get("/icon.svg");
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toContain("svg");
  });
});

const ADMIN_PAGES = ["/admin", "/admin/leads", "/admin/leads/new", "/admin/clients", "/admin/automation", "/admin/integration", "/admin/sync-log", "/admin/settings", "/admin/staff"];

test.describe("responsive layout", () => {
  for (const width of [360, 768, 1024, 1440]) {
    test(`no page scrolls sideways at ${width}px`, async ({ page, request }) => {
      test.setTimeout(150_000);
      const { id } = await createLead(request);
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/", "/login", ...ADMIN_PAGES, `/admin/leads/${id}`]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await hasHorizontalScroll(page), `${path} at ${width}px`).toBe(false);
      }
    });
  }
});

/** The demo must never pass itself off as a real integration. */
test.describe("demo mode is honest", () => {
  const BANNER = "Демонстрационный режим: заявки не уходят в настоящий Битрикс24";

  test("every admin page carries the demo banner", async ({ page, request }) => {
    const { id } = await createLead(request);
    for (const path of [...ADMIN_PAGES, `/admin/leads/${id}`]) {
      await page.goto(path);
      await expect(page.getByText(BANNER), path).toBeVisible();
    }
  });

  test("managers see the banner too, without a link to administration", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.anna });
    const page = await ctx.newPage();
    for (const path of ["/admin", "/admin/leads"]) {
      await page.goto(path);
      await expect(page.getByText(BANNER)).toBeVisible();
    }
    await ctx.close();
  });

  test("the integration page and the connection check say it is a simulation", async ({ page }) => {
    await page.goto("/admin/integration");
    await expect(page.getByText("Демо-режим", { exact: true })).toBeVisible();
    await expect(page.getByText("demo.bitrix24.ru (имитация)")).toBeVisible();
    await expect(page.getByText("Ни одна заявка не уходит на настоящий портал")).toBeVisible();
    await page.getByRole("button", { name: "Проверить соединение" }).click();
    await expect(page.getByText("Демо-ответ получен")).toBeVisible();
    await expect(page.getByText("Это имитация: реальный портал не опрашивался")).toBeVisible();
  });

  test("a simulated send is labelled in the list, the card and the journal", async ({ page, request }) => {
    const { id, body } = await createLead(request);
    await waitForSyncStatus(id, "synced");

    await page.goto(`/admin/leads?q=${encodeURIComponent(body.email)}`);
    await expect(page.locator("tbody tr").first().getByText("демо", { exact: true })).toBeVisible();

    await page.goto(`/admin/leads/${id}`);
    await expect(page.getByText("Демо-ID лида")).toBeVisible();
    await expect(page.getByText("Это результат имитации: в настоящий Битрикс24 заявка не отправлялась")).toBeVisible();

    await page.goto(`/admin/sync-log?lead=${id}`);
    await expect(page.locator("tbody tr").first().getByText("демо", { exact: true })).toBeVisible();
    await page.locator("tbody tr").first().getByRole("link").first().click();
    await expect(page.getByText("Демонстрационный: ответ имитирован, портал не опрашивался")).toBeVisible();
  });

  test("the public form promises an answer from a manager, not a delivery to a CRM, and says it is a demo", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await expect(page.getByText("Демонстрационный проект: заявка сохраняется в тестовой базе")).toBeVisible();
    await page.getByLabel("Имя", { exact: true }).fill("Проверка текста");
    await page.getByLabel("Телефон").fill("+7 900 600-70-80");
    await page.getByLabel("Email").fill(`wording-${Date.now()}@example.com`);
    await page.getByLabel("Услуга").selectOption("support");
    await page.waitForTimeout(2100);
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    const done = page.getByRole("status").filter({ hasText: "Заявка принята" });
    await expect(done).toBeVisible();
    expect(await done.innerText()).not.toMatch(/Битрикс|CRM|передан/i);
  });
});
