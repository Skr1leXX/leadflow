import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { AUTH, createLead, dbAll, leadRow, uniq, waitForSyncStatus } from "./helpers";

test.use({ storageState: AUTH.admin });

const rows = (page: Page) => page.locator("tbody tr");
const journal = (page: Page, id: string, extra = "") => page.goto(`/admin/sync-log?lead=${id}${extra}`);

async function addComment(page: Page, id: string, text: string) {
  await page.goto(`/admin/leads/${id}`);
  await page.getByLabel("Новый комментарий").fill(text);
  await page.getByRole("button", { name: "Добавить комментарий" }).click();
  await expect(page.getByText("Комментарий добавлен")).toBeVisible();
}

test.describe("sync journal", () => {
  test("a successful send is journaled with type, local ID, Bitrix24 ID, status, attempt and a detail page", async ({ page, request }) => {
    const { id, body } = await createLead(request);
    await waitForSyncStatus(id, "synced");
    const bitrixId = String(leadRow(id)?.bitrix_lead_id);

    await journal(page, id);
    await expect(rows(page)).toHaveCount(1);
    const row = rows(page).first();
    await expect(row).toContainText("Создание лида");
    await expect(row).toContainText(body.name);
    await expect(row).toContainText(id);
    await expect(row).toContainText(bitrixId);
    await expect(row).toContainText("Успешно");
    await expect(row).toContainText("демо");

    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/admin\/sync-log\/ev-/);
    await expect(page.getByRole("heading", { name: "Создание лида" })).toBeVisible();
    const main = page.locator("main");
    await expect(main.getByText("crm.lead.add")).toBeVisible();
    await expect(main.getByText("Номер попытки").locator("xpath=following-sibling::dd")).toHaveText("1");
    await expect(main.getByText("ID в Битрикс24").locator("xpath=following-sibling::dd")).toHaveText(bitrixId);
    await expect(main.getByText("Демонстрационный: ответ имитирован")).toBeVisible();
    await expect(main.getByRole("link", { name: new RegExp(id) })).toHaveAttribute("href", `/admin/leads/${id}`);
    await expect(main.getByText("маскируются")).toBeVisible();
  });

  test("a failed send shows the error code and message, no Bitrix24 ID, and the lead keeps working", async ({ page, request }) => {
    const { id } = await createLead(request, { email: `jerr-${uniq()}@bitrix-error.test` });
    await waitForSyncStatus(id, "failed");

    await journal(page, id, "&status=error");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Ошибка");
    await journal(page, id, "&status=ok");
    await expect(rows(page)).toHaveCount(0);

    await journal(page, id);
    await rows(page).first().getByRole("link").first().click();
    await expect(page).toHaveURL(/\/admin\/sync-log\/ev-/);
    await expect(page.getByRole("heading", { name: "Создание лида" })).toBeVisible(); // the detail page, not the list it replaces
    const main = page.locator("main");
    // Next keeps the previous page hidden in the DOM, so look at visible elements only
    await expect(main.getByText("превышен лимит запросов").filter({ visible: true })).toHaveCount(1);
    await expect(main.getByText("QUERY_LIMIT_EXCEEDED").filter({ visible: true })).toHaveCount(1);
    await expect(main.getByText("ID в Битрикс24").locator("xpath=following-sibling::dd")).toHaveText("не получен");
  });

  test("a manual retry from the lead card is journaled as attempt 2 and a flaky portal then succeeds", async ({ page, request }) => {
    const bad = await createLead(request, { email: `jretry-${uniq()}@bitrix-error.test` });
    await waitForSyncStatus(bad.id, "failed");
    await page.goto(`/admin/leads/${bad.id}`);
    await expect(page.getByText("Ошибка отправки").first()).toBeVisible();
    await page.getByRole("button", { name: "Повторить отправку (демо)" }).click();
    await expect(page.getByText("превышен лимит запросов").first()).toBeVisible();
    await expect.poll(() => leadRow(bad.id)?.sync_attempts).toBe(2);
    await journal(page, bad.id);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first()).toContainText("2");

    const flaky = await createLead(request, { email: `jflaky-${uniq()}@bitrix-flaky.test` });
    await waitForSyncStatus(flaky.id, "failed");
    await page.goto(`/admin/leads/${flaky.id}`);
    await page.getByRole("button", { name: "Повторить отправку (демо)" }).click();
    await expect(page.getByText(/Демо: лид создан в имитации, ID \d+/)).toBeVisible();
    await expect.poll(() => leadRow(flaky.id)?.sync_status).toBe("synced");
    expect(leadRow(flaky.id)).toMatchObject({ sync_attempts: 2, sync_error: null });
    expect(leadRow(flaky.id)?.bitrix_lead_id).toBeTruthy();

    await journal(page, flaky.id);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toContainText("Успешно");
    await expect(rows(page).nth(1)).toContainText("Ошибка");
    // the retry button is gone once the lead is synced
    await page.goto(`/admin/leads/${flaky.id}`);
    await expect(page.getByRole("button", { name: /Повторить отправку/ })).toHaveCount(0);
  });

  test("filters by operation type, status and date", async ({ page, request }) => {
    const { id } = await createLead(request);
    await waitForSyncStatus(id, "synced");
    await addComment(page, id, `Комментарий ${uniq()}`);
    await page.goto(`/admin/leads/${id}`);
    await page.locator("#lead-status").selectOption("won");
    await expect(page.getByText("Статус обновлён")).toBeVisible();
    await expect.poll(() => dbAll("SELECT status FROM outbox WHERE lead_id = ?", id).every((o) => o.status === "done")).toBe(true);

    await journal(page, id);
    await expect(rows(page)).toHaveCount(3);

    for (const [type, label] of [["crm.lead.add", "Создание лида"], ["crm.lead.update", "Обновление лида"], ["crm.timeline.comment.add", "Комментарий в ленте"]] as const) {
      await journal(page, id, `&type=${type}`);
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first()).toContainText(label);
    }

    // the same filters through the form
    await journal(page, id);
    await page.locator("select[name=type]").selectOption("crm.lead.update");
    await page.locator("select[name=status]").selectOption("ok");
    await page.getByRole("button", { name: "Применить" }).click();
    await expect(page).toHaveURL(/type=crm\.lead\.update/);
    await expect(rows(page)).toHaveCount(1);

    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
    await journal(page, id, `&from=${today}&to=${today}`);
    await expect(rows(page)).toHaveCount(3);
    await journal(page, id, "&from=2020-01-01&to=2020-12-31");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText("Ничего не найдено")).toBeVisible();
    await journal(page, id, "&to=2020-12-31");
    await expect(rows(page)).toHaveCount(0);

    await page.getByRole("link", { name: "Сбросить" }).click();
    await expect(page).toHaveURL(/\/admin\/sync-log$/);
  });

  test("a failed comment push is kept with its code, retried by hand, and the comment itself is never lost", async ({ page, request }) => {
    const { id } = await createLead(request);
    await waitForSyncStatus(id, "synced");
    const text = `Сбой доставки [demo-error] ${uniq()}`;
    await addComment(page, id, text);
    await expect.poll(() => dbAll("SELECT status, last_error_code FROM outbox WHERE lead_id = ? AND kind = 'comment'", id)[0]?.status).toBe("failed");
    expect(dbAll("SELECT last_error_code FROM outbox WHERE lead_id = ?", id)[0].last_error_code).toBe("PORTAL_UNREACHABLE");

    await page.reload();
    await expect(page.getByRole("list").getByText(text)).toBeVisible(); // still in the history
    await expect(page.getByText("PORTAL_UNREACHABLE").first()).toBeVisible();
    await page.getByRole("button", { name: "Отправить сейчас" }).click();
    await expect(page.getByText("портал недоступен").first()).toBeVisible();
    await expect.poll(() => dbAll("SELECT attempts FROM outbox WHERE lead_id = ?", id)[0].attempts).toBe(2);

    await journal(page, id, "&status=error");
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first()).toContainText("Комментарий в ленте");
  });

  test("the journal pages through its entries and keeps the filters in the links", async ({ page }) => {
    await page.goto("/admin/sync-log?status=ok");
    await expect(rows(page)).toHaveCount(20);
    const nav = page.getByRole("navigation", { name: "Страницы" });
    await nav.getByRole("link", { name: "2", exact: true }).click();
    await expect(page).toHaveURL(/status=ok/);
    await expect(page).toHaveURL(/page=2/);
    await expect(nav).toContainText("Страница 2 из");
  });

  test("an unknown entry or lead shows the not-found page, not a crash", async ({ page }) => {
    // The page streams, so the status line is already 200 when the not-found view replaces the content.
    for (const path of ["/admin/sync-log/ev-does-not-exist", "/admin/leads/lead-does-not-exist"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
    }
  });
});
