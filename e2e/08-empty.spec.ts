import { test, expect } from "./fixtures";
import { E2E, hasHorizontalScroll, login } from "./helpers";

// A deployment started without LEADFLOW_DEMO: what a customer gets on day one. No fictional leads, no demo accounts.

test.describe.configure({ mode: "serial" });

test("the login page lists no demo accounts and the health check is green", async ({ page, request }) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  await page.goto("/login");
  await expect(page.getByTestId("demo-logins")).toHaveCount(0);
  await expect(page.getByText("leadflow-demo")).toHaveCount(0);
});

test("demo manager accounts do not exist in a plain production start", async ({ page }) => {
  await login(page, "olga@example.com", "leadflow-demo");
  await expect(page.getByText("Неверная почта или пароль")).toBeVisible();
});

test("an empty system shows clear empty states instead of broken pages", async ({ page }) => {
  await login(page, E2E.adminEmail, E2E.adminPassword);
  await expect(page).toHaveURL(/\/admin$/);

  await expect(page.getByTestId("kpis").locator("[data-slot=card]").filter({ hasText: "Всего заявок" }).locator("p").nth(1)).toHaveText("0");
  await expect(page.getByTestId("demo-notice")).toHaveCount(0);
  await expect(page.getByText("Заявок пока нет")).toBeVisible();
  await expect(page.getByTestId("status-distribution")).toContainText("Нет данных за выбранный период");
  await expect(page.getByRole("img", { name: /График поступления заявок/ })).toBeVisible();

  await page.goto("/admin/leads");
  await expect(page.getByText("Ничего не найдено")).toBeVisible();
  await page.goto("/admin/clients");
  await expect(page.getByText("Ничего не найдено")).toBeVisible();
  await page.goto("/admin/sync-log");
  await expect(page.getByText("Ничего не найдено")).toBeVisible();
  await page.goto("/admin/automation");
  await expect(page.getByText("Правил пока нет")).toBeVisible();
  await page.goto("/admin/staff");
  await expect(page.locator("main [data-slot=card]").filter({ hasText: E2E.adminEmail })).toHaveCount(1);
  await expect(page.getByText("Это вы")).toBeVisible();
  await page.goto("/admin/integration");
  await expect(page.getByText("Не задан", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Боевой" })).toBeDisabled();
  await expect(page.getByText("Появится после первой заявки")).toBeVisible();
});

test("the first real lead goes through the whole chain on an empty system", async ({ page, browser }) => {
  const visitor = await browser.newContext();
  const form = await visitor.newPage();
  await form.goto("/");
  await form.getByLabel("Имя", { exact: true }).fill("Первый Клиент");
  await form.getByLabel("Телефон").fill("+7 900 700-80-90");
  await form.getByLabel("Email").fill("first@example.com");
  await form.getByLabel("Услуга").selectOption("crm-integration");
  await form.waitForTimeout(2100);
  await form.getByRole("button", { name: "Отправить заявку" }).click();
  await expect(form.getByText("Заявка принята")).toBeVisible();
  await visitor.close();

  await login(page, E2E.adminEmail, E2E.adminPassword);
  await expect(page.getByTestId("kpis").locator("[data-slot=card]").filter({ hasText: "Всего заявок" }).locator("p").nth(1)).toHaveText("1");
  await expect(page.getByTestId("demo-notice")).toHaveCount(0); // a real lead is not a demo record
  await page.goto("/admin/leads");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("демо-запись")).toHaveCount(0);
  await page.getByRole("link", { name: "Первый Клиент" }).click();
  await expect(page.getByText("Отправлено").first()).toBeVisible({ timeout: 20_000 });
  expect(await hasHorizontalScroll(page)).toBe(false);
});
