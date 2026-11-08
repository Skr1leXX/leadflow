import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { AUTH, createLead, dbAll, hasHorizontalScroll } from "./helpers";

test.use({ storageState: AUTH.admin });

// ---- an independent calculation straight from the database, to compare with what the page shows ----------------------

const MSK = "Europe/Moscow";
const todayMsk = () => new Date().toLocaleDateString("sv-SE", { timeZone: MSK });
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const startIso = (day: string) => new Date(`${day}T00:00:00+03:00`).toISOString();

interface Counts {
  total: number;
  new: number;
  in_progress: number;
  awaiting_reply: number;
  won: number;
  rejected: number;
  website: number;
  manual: number;
  demo: number;
}

function expected(from: string, to: string, includeDemo = true): Counts {
  const rows = dbAll(
    `SELECT status, source, demo_data FROM leads WHERE created_at >= ? AND created_at < ? ${includeDemo ? "" : "AND demo_data = 0"}`,
    startIso(from),
    startIso(addDays(to, 1)),
  );
  const c: Counts = { total: rows.length, new: 0, in_progress: 0, awaiting_reply: 0, won: 0, rejected: 0, website: 0, manual: 0, demo: 0 };
  for (const r of rows) {
    c[r.status as "new"]++;
    c[r.source as "website"]++;
    if (r.demo_data === 1) c.demo++;
  }
  return c;
}

const PRESET_DAYS = { week: 7, month: 30, quarter: 90 } as const;
const presetRange = (p: keyof typeof PRESET_DAYS) => ({ from: addDays(todayMsk(), 1 - PRESET_DAYS[p]), to: todayMsk() });

// ---- reading the page ------------------------------------------------------------------------------------------

const kpi = async (page: Page, label: string) => {
  const card = page.getByTestId("kpis").locator("[data-slot=card]").filter({ hasText: label });
  return (await card.locator("p").nth(1).innerText()).trim();
};
const kpiNum = async (page: Page, label: string) => Number(await kpi(page, label));
const listCounts = async (page: Page, testId: string) => {
  const items = page.getByTestId(testId).locator("li");
  const out: Record<string, number> = {};
  for (const li of await items.all()) out[(await li.locator("span").first().innerText()).trim()] = Number(await li.locator("b").innerText());
  return out;
};
const conversionText = (won: number, total: number) => `${(total ? Math.round((won / total) * 1000) / 10 : 0).toString().replace(".", ",")}%`;

test.describe("dashboard analytics", () => {
  test("shows every required indicator, chart and distribution", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    for (const label of ["Всего заявок", "Новые", "В работе", "Успешно завершены", "Отклонены", "Конверсия"]) {
      await expect(page.getByTestId("kpis").locator("[data-slot=card]").filter({ hasText: label })).toHaveCount(1);
    }
    await expect(page.getByRole("img", { name: /График поступления заявок по дням/ })).toBeVisible();
    await expect(page.locator(".recharts-area").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Распределение по статусам" })).toBeVisible();
    for (const status of ["Новая", "В работе", "Ожидает ответа", "Успешно завершён", "Отклонён"]) await expect(page.getByTestId("status-distribution")).toContainText(status);
    await expect(page.getByTestId("sources")).toContainText("Форма на сайте");
    await expect(page.getByTestId("services")).toContainText("Интеграция с Битрикс24");
    await expect(page.getByText("Все показатели считаются по заявкам в базе данных")).toBeVisible();
  });

  for (const period of ["week", "month", "quarter"] as const) {
    test(`every figure for "${period}" equals an independent count from the database`, async ({ page }) => {
      await page.goto(`/admin?period=${period}`);
      const { from, to } = presetRange(period);
      const want = expected(from, to);
      expect(want.total, "the database has leads in the period").toBeGreaterThan(0);

      expect(await kpiNum(page, "Всего заявок")).toBe(want.total);
      expect(await kpiNum(page, "Новые")).toBe(want.new);
      expect(await kpiNum(page, "В работе")).toBe(want.in_progress);
      expect(await kpiNum(page, "Успешно завершены")).toBe(want.won);
      expect(await kpiNum(page, "Отклонены")).toBe(want.rejected);
      expect(await kpi(page, "Конверсия")).toBe(conversionText(want.won, want.total));

      const statuses = await listCounts(page, "status-distribution");
      expect(statuses).toEqual({ Новая: want.new, "В работе": want.in_progress, "Ожидает ответа": want.awaiting_reply, "Успешно завершён": want.won, Отклонён: want.rejected });
      const sources = await listCounts(page, "sources");
      expect(sources["Форма на сайте"] ?? 0).toBe(want.website);
      expect(sources["Вручную"] ?? 0).toBe(want.manual);
      const services = await listCounts(page, "services");
      expect(Object.values(services).reduce((a, b) => a + b, 0)).toBe(want.total);
    });
  }

  test("a period is covered end to end: the page names its dates", async ({ page }) => {
    await page.goto("/admin?period=week");
    const { from, to } = presetRange("week");
    const ru = (d: string) => d.split("-").reverse().join(".");
    await expect(page.getByText(`${ru(from)} — ${ru(to)}`).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Неделя" })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("img", { name: new RegExp(ru(from)) })).toBeVisible();
  });

  test("switching the period changes the numbers consistently", async ({ page }) => {
    await page.goto("/admin?period=week");
    const week = await kpiNum(page, "Всего заявок");
    await page.getByRole("link", { name: "Квартал" }).click();
    await expect(page).toHaveURL(/period=quarter/);
    await expect(page.getByRole("link", { name: "Квартал" })).toHaveAttribute("aria-current", "true");
    const quarter = await kpiNum(page, "Всего заявок");
    await page.getByRole("link", { name: "Месяц" }).click();
    await expect(page).toHaveURL(/period=month/);
    const month = await kpiNum(page, "Всего заявок");
    expect(week).toBeLessThanOrEqual(month);
    expect(month).toBeLessThanOrEqual(quarter);
    expect(quarter).toBe(expected(presetRange("quarter").from, todayMsk()).total);
  });

  test("a custom period works from the form, and a bad one falls back with an explanation", async ({ page }) => {
    const today = todayMsk();
    const from = addDays(today, -9);
    await page.goto("/admin");
    await page.getByLabel("Начало периода").fill(from);
    await page.getByLabel("Конец периода").fill(today);
    await page.getByRole("button", { name: "Показать период" }).click();
    await expect(page).toHaveURL(/period=custom/);
    expect(await kpiNum(page, "Всего заявок")).toBe(expected(from, today).total);
    await expect(page.getByRole("img", { name: /График/ })).toBeVisible();

    await page.goto(`/admin?period=custom&from=${today}&to=${addDays(today, -3)}`);
    await expect(page.getByRole("alert").filter({ hasText: "Начало периода позже конца" })).toBeVisible();
    expect(await kpiNum(page, "Всего заявок")).toBe(expected(presetRange("month").from, today).total);

    await page.goto(`/admin?period=custom&from=2020-01-01&to=${today}`);
    await expect(page.getByRole("alert").filter({ hasText: "длиннее" })).toBeVisible();
    await page.goto("/admin?period=custom");
    await expect(page.getByRole("alert").filter({ hasText: "Укажите обе даты" })).toBeVisible();
  });

  test("one day is a valid period and today's new leads are counted", async ({ page, request }) => {
    const today = todayMsk();
    await page.goto(`/admin?period=custom&from=${today}&to=${today}`);
    const before = await kpiNum(page, "Всего заявок");
    expect(before).toBe(expected(today, today).total);
    await createLead(request);
    await createLead(request);
    await page.reload();
    expect(await kpiNum(page, "Всего заявок")).toBe(before + 2);
    expect(await kpiNum(page, "Новые")).toBe(expected(today, today).new);
  });

  test("changing a lead's status moves it between the indicators and the conversion follows", async ({ page, request }) => {
    const { id } = await createLead(request);
    await page.goto("/admin?period=week");
    const [total, fresh, won] = [await kpiNum(page, "Всего заявок"), await kpiNum(page, "Новые"), await kpiNum(page, "Успешно завершены")];

    await page.goto(`/admin/leads/${id}`);
    await page.locator("#lead-status").selectOption("won");
    await expect(page.getByText("Статус обновлён")).toBeVisible();

    await page.goto("/admin?period=week");
    expect(await kpiNum(page, "Всего заявок")).toBe(total);
    expect(await kpiNum(page, "Новые")).toBe(fresh - 1);
    expect(await kpiNum(page, "Успешно завершены")).toBe(won + 1);
    expect(await kpi(page, "Конверсия")).toBe(conversionText(won + 1, total));
  });

  test("demo data are labelled, can be hidden, and the figures then cover real leads only", async ({ page }) => {
    await page.goto("/admin?period=quarter");
    const withDemo = expected(presetRange("quarter").from, todayMsk());
    expect(withDemo.demo, "the demo seed is in the period").toBeGreaterThan(0);
    const notice = page.getByTestId("demo-notice");
    await expect(notice).toContainText(`${withDemo.demo} демонстрационных заявок`);
    await expect(notice).toContainText("вымышленные");

    await notice.getByRole("link", { name: "Скрыть демо-данные" }).click();
    await expect(page).toHaveURL(/demo=hide/);
    await expect(page.getByTestId("demo-notice")).toContainText("Демонстрационные данные скрыты");
    const real = expected(presetRange("quarter").from, todayMsk(), false);
    expect(await kpiNum(page, "Всего заявок")).toBe(real.total);
    expect(real.total).toBe(withDemo.total - withDemo.demo);
    await expect(page.getByTestId("demo-notice")).toContainText("Демонстрационные данные скрыты");
    await expect(page.getByRole("link", { name: "Месяц" })).toHaveAttribute("href", /demo=hide/);

    await page.getByRole("link", { name: "Показать демо-данные" }).click();
    await expect(page).not.toHaveURL(/demo=hide/);
    await expect(page.getByTestId("demo-notice")).toContainText("В расчёт входят");
    expect(await kpiNum(page, "Всего заявок")).toBe(withDemo.total);
  });

  test("a manager can read the dashboard too", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.anna });
    const page = await ctx.newPage();
    await page.goto("/admin");
    await expect(page.getByTestId("kpis")).toBeVisible();
    expect(await kpiNum(page, "Всего заявок")).toBeGreaterThan(0);
    expect(await hasHorizontalScroll(page)).toBe(false);
    await ctx.close();
  });
});
