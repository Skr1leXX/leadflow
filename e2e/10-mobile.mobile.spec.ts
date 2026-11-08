import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { AUTH, MANAGER_A, createLead, hasHorizontalScroll, leadRow, leadsByEmail, uniq, waitForSyncStatus } from "./helpers";

// Runs with a phone profile (Pixel 7: touch, narrow viewport, mobile user agent).

/** Interactive elements that are visible but too small to tap comfortably (WCAG 2.5.8 asks for 24 px, we hold 36). */
async function tinyTargets(page: Page, min = 36) {
  return page.evaluate((m) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]):not([type=checkbox]), select, textarea, [role=switch]")) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || el.closest(".sr-only, [aria-hidden=true]")) continue;
      // links inside running text are exempt; block-level and standalone ones are not
      if (el.tagName === "A" && style.display === "inline") continue;
      if (r.height < m || r.width < m) out.push(`${el.tagName.toLowerCase()} "${((el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).name || "").trim()).slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, min);
}

test.describe("public site on a phone", () => {
  test("fits the screen, validates, and submits a lead", async ({ page }) => {
    await page.goto("/");
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expect(page.getByRole("heading", { level: 1, name: "Оставьте заявку" })).toBeVisible();

    await page.getByRole("button", { name: "Отправить заявку" }).tap();
    await expect(page.getByText("Укажите имя, минимум 2 символа")).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);

    const email = `mob-${uniq()}@example.com`;
    await page.getByLabel("Имя", { exact: true }).fill("Мобильный Клиент");
    await page.getByLabel("Телефон").fill("+7 900 555-66-77");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Услуга").selectOption("web-development");
    expect(await tinyTargets(page)).toEqual([]);
    await page.waitForTimeout(2100);
    await page.getByRole("button", { name: "Отправить заявку" }).tap();
    await expect(page.getByText("Заявка принята")).toBeVisible();
    expect(leadsByEmail(email)).toHaveLength(1);
    await waitForSyncStatus(leadsByEmail(email)[0].id as string, "synced");
  });

  test("the login page fits and is usable", async ({ page }) => {
    await page.goto("/login");
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expect(page.getByLabel("Почта")).toBeVisible();
    expect(await tinyTargets(page)).toEqual([]);
  });
});

test.describe("administration on a phone", () => {
  test.use({ storageState: AUTH.admin });

  test("the dashboard fits, and the menu opens, navigates and closes", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("kpis")).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
    expect(await tinyTargets(page)).toEqual([]);

    await expect(page.getByRole("navigation", { name: "Разделы" })).toHaveCount(0); // the sidebar is hidden on a phone
    await page.getByRole("button", { name: "Меню" }).tap();
    const nav = page.getByRole("navigation", { name: "Разделы" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(8);
    await nav.getByRole("link", { name: "Заявки" }).tap();
    await expect(page).toHaveURL(/\/admin\/leads$/);
    await expect(page.getByRole("navigation", { name: "Разделы" })).toHaveCount(0);
  });

  test("the period picker and the charts work on a phone", async ({ page }) => {
    await page.goto("/admin?period=week");
    await page.getByRole("link", { name: "Квартал" }).tap();
    await expect(page).toHaveURL(/period=quarter/);
    await expect(page.getByRole("img", { name: /График поступления заявок/ })).toBeVisible();
    await expect(page.getByTestId("status-distribution")).toBeVisible();
    await expect(page.getByTestId("demo-notice")).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test("the leads list keeps its filters behind a toggle, searches, and the card is usable", async ({ page, request }) => {
    const { id, body } = await createLead(request);
    await waitForSyncStatus(id, "synced");

    await page.goto("/admin/leads");
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expect(page.locator("select[name=status]")).toBeHidden();
    await page.getByText("Фильтры и сортировка").tap();
    await expect(page.locator("select[name=status]")).toBeVisible();
    await page.getByLabel("Поиск по имени, телефону и email").fill(body.email);
    await page.getByRole("button", { name: "Применить" }).tap();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr").first()).toContainText(body.name);
    expect(await hasHorizontalScroll(page)).toBe(false);

    await page.getByRole("link", { name: body.name }).tap();
    await expect(page.getByRole("heading", { name: body.name })).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
    expect(await tinyTargets(page)).toEqual([]);

    await page.locator("#lead-status").selectOption("in_progress");
    await expect(page.getByText("Статус обновлён")).toBeVisible();
    await page.locator("#lead-assignee").selectOption({ label: MANAGER_A.name });
    await expect(page.getByText("Ответственный назначен")).toBeVisible();
    expect(leadRow(id)).toMatchObject({ status: "in_progress" });
    await page.getByLabel("Новый комментарий").fill("С телефона");
    await page.getByRole("button", { name: "Добавить комментарий" }).tap();
    await expect(page.getByText("Комментарий добавлен")).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test("the lead form and the journal fit and work", async ({ page }) => {
    await page.goto("/admin/leads/new");
    expect(await hasHorizontalScroll(page)).toBe(false);
    expect(await tinyTargets(page)).toEqual([]);

    await page.goto("/admin/sync-log");
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.locator("select[name=status]").selectOption("error");
    await page.getByRole("button", { name: "Применить" }).tap();
    await expect(page).toHaveURL(/status=error/);
    await page.locator("tbody tr").first().getByRole("link").first().tap();
    await expect(page.getByText("Подробности").first()).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test("the other admin pages fit the screen", async ({ page }) => {
    for (const path of ["/admin/clients", "/admin/integration", "/admin/settings", "/admin/staff", "/admin/automation"]) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      expect(await hasHorizontalScroll(page), path).toBe(false);
    }
  });
});

test.describe("a manager on a phone", () => {
  test.use({ storageState: AUTH.anna });

  test("the menu offers only the manager's three sections", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: "Меню" }).tap();
    const links = await page.getByRole("navigation", { name: "Разделы" }).getByRole("link").allInnerTexts();
    expect(links.map((l) => l.trim())).toEqual(["Dashboard", "Заявки", "Клиенты"]);
  });
});
