import { test, expect } from "./fixtures";
import { AUTH, MANAGER_A, createLead, dbAll, leadRow, uniq, waitForSyncStatus } from "./helpers";

test.use({ storageState: AUTH.admin });

const rows = (page: import("@playwright/test").Page) => page.locator("tbody tr");

test.describe("leads list: search, filters, sorting, pages", () => {
  const n = uniq();
  const names = { anna: `Яблокова${n}`, boris: `Бобров${n}`, vera: `Волкова${n}` };
  const emails = { anna: `anna-${n}@search.test`, boris: `boris-${n}@search.test`, vera: `vera-${n}@search.test` };
  const phones = { anna: "+7 901 000-11-01", boris: "+7 902 000-11-02", vera: "+7 903 000-11-03" };

  test.beforeAll(async ({ request }) => {
    await createLead(request, { name: names.anna, email: emails.anna, phone: phones.anna, serviceId: "web-development" });
    await createLead(request, { name: names.boris, email: emails.boris, phone: phones.boris, serviceId: "support" });
    await createLead(request, { name: names.vera, email: emails.vera, phone: phones.vera, serviceId: "analytics" });
  });

  test("the list shows every column with real values and marks demo records", async ({ page }) => {
    await page.goto(`/admin/leads?q=${n}`);
    const row = rows(page).filter({ hasText: names.anna });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("+79010001101");
    await expect(row).toContainText("Сайты и веб-приложения");
    await expect(row).toContainText("Сайт");
    await expect(row).toContainText("не назначен");
    await expect(row).toContainText("Новая");
    await expect(row.getByText("демо-запись")).toHaveCount(0);

    await page.goto("/admin/leads?sort=created&dir=asc");
    await expect(rows(page).first()).toContainText("демо-запись");
  });

  test("search finds leads by name (any case), phone digits and email, and says so when nothing matches", async ({ page }) => {
    const search = async (q: string) => {
      await page.goto("/admin/leads");
      await page.getByLabel("Поиск по имени, телефону и email").fill(q);
      await page.getByRole("button", { name: "Применить" }).click();
      await expect(page).toHaveURL(/q=/);
    };
    await search(names.anna.toUpperCase());
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(names.anna);

    await search("902 000-11");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(names.boris);

    await search(emails.vera.toUpperCase());
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(names.vera);

    await search(`нет-такого-${uniq()}`);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText("Ничего не найдено")).toBeVisible();
  });

  test("filters by status, source, responsible and date combine with the search", async ({ page }) => {
    await page.goto(`/admin/leads?q=${n}`);
    await expect(rows(page)).toHaveCount(3);

    await page.locator("select[name=status]").selectOption("won");
    await page.getByRole("button", { name: "Применить" }).click();
    await expect(page.getByText("Ничего не найдено")).toBeVisible();

    await page.goto(`/admin/leads?q=${n}&status=new&source=website&assignee=none`);
    await expect(rows(page)).toHaveCount(3);
    await page.goto(`/admin/leads?q=${n}&source=manual`);
    await expect(rows(page)).toHaveCount(0);

    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
    await page.goto(`/admin/leads?q=${n}&from=${today}&to=${today}`);
    await expect(rows(page)).toHaveCount(3);
    await page.goto(`/admin/leads?q=${n}&from=2020-01-01&to=2020-01-02`);
    await expect(rows(page)).toHaveCount(0);

    await page.goto(`/admin/leads?q=${n}&status=new`);
    await page.getByRole("link", { name: "Сбросить" }).click();
    await expect(page).toHaveURL(/\/admin\/leads$/);
  });

  test("sorting by name works in both directions", async ({ page }) => {
    const first = async (dir: string) => {
      await page.goto(`/admin/leads?q=${n}&sort=name&dir=${dir}`);
      return rows(page).first().innerText();
    };
    expect(await first("asc")).toContain(names.boris); // alphabetical: Бобров, Волкова, Яблокова
    expect(await first("desc")).toContain(names.anna);
  });

  test("pages keep the filters and clamp out-of-range page numbers", async ({ page }) => {
    await page.goto("/admin/leads?sort=name&dir=asc");
    await expect(rows(page)).toHaveCount(15);
    const nav = page.getByRole("navigation", { name: "Страницы" });
    await expect(nav).toContainText("Страница 1 из");
    await nav.getByRole("link", { name: "2", exact: true }).click();
    await expect(page).toHaveURL(/sort=name/);
    await expect(page).toHaveURL(/page=2/);
    await expect(nav).toContainText("Страница 2 из");

    await page.goto("/admin/leads?page=9999");
    await expect(nav).toContainText(/Страница \d+ из \d+/);
    const total = Number((await nav.innerText()).match(/всего (\d+)/)![1]);
    expect(total).toBe(dbAll("SELECT COUNT(*) AS n FROM leads")[0].n);
  });
});

test.describe("lead card: status, responsible, comments, history", () => {
  test("an admin changes the status and assigns a responsible person; both are saved and shown in the history", async ({ page, request }) => {
    const { id, body } = await createLead(request, { name: `Карточка ${uniq()}` });
    await waitForSyncStatus(id, "synced");

    await page.goto("/admin/leads");
    await page.getByLabel("Поиск по имени, телефону и email").fill(body.email);
    await page.getByRole("button", { name: "Применить" }).click();
    await page.getByRole("link", { name: body.name }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/leads/${id}$`));
    await expect(page.getByRole("heading", { name: body.name })).toBeVisible();
    await expect(page.getByText(body.comment)).toBeVisible();

    await page.locator("#lead-status").selectOption("in_progress");
    await expect(page.getByText("Статус обновлён")).toBeVisible();
    expect(leadRow(id)?.status).toBe("in_progress");

    await page.locator("#lead-assignee").selectOption({ label: MANAGER_A.name });
    await expect(page.getByText("Ответственный назначен")).toBeVisible();
    expect(leadRow(id)?.assignee_id).toBeTruthy();

    await page.reload();
    await expect(page.getByText("Статус: Новая → В работе")).toBeVisible();
    await expect(page.getByText(`Ответственный: не назначен → ${MANAGER_A.name}`)).toBeVisible();
    await expect(page.locator("#lead-status")).toHaveValue("in_progress");

    // the filters see the change
    await page.goto(`/admin/leads?q=${encodeURIComponent(body.email)}&status=in_progress`);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(MANAGER_A.name);
    await page.goto(`/admin/leads?q=${encodeURIComponent(body.email)}&status=new`);
    await expect(rows(page)).toHaveCount(0);
  });

  test("all five statuses can be set", async ({ page, request }) => {
    const { id } = await createLead(request);
    await page.goto(`/admin/leads/${id}`);
    for (const value of ["in_progress", "awaiting_reply", "won", "rejected", "new"] as const) {
      await page.locator("#lead-status").selectOption(value);
      await expect.poll(() => leadRow(id)?.status).toBe(value);
      await expect(page.getByRole("status").filter({ hasText: "Статус обновлён" }).last()).toBeVisible();
      await expect(page.locator("#lead-status")).toHaveValue(value);
    }
  });

  test("a comment is saved, shown in the history and queued for Bitrix24", async ({ page, request }) => {
    const { id } = await createLead(request);
    await waitForSyncStatus(id, "synced");
    await page.goto(`/admin/leads/${id}`);

    await page.getByRole("button", { name: "Добавить комментарий" }).click();
    await expect(page.getByText("Введите текст комментария")).toBeVisible();

    const text = `Позвонить завтра ${uniq()}`;
    await page.getByLabel("Новый комментарий").fill(text);
    await page.getByRole("button", { name: "Добавить комментарий" }).click();
    await expect(page.getByText("Комментарий добавлен")).toBeVisible();
    await expect(page.getByRole("list").getByText(text)).toBeVisible();
    await expect.poll(() => dbAll("SELECT status FROM outbox WHERE lead_id = ? AND kind = 'comment'", id).map((o) => o.status)).toEqual(["done"]);
  });
});

test.describe("manual leads", () => {
  test("the form validates, creates a lead with source 'Вручную' and does not duplicate on a double click", async ({ page }) => {
    await page.goto("/admin/leads/new");
    await page.getByRole("button", { name: "Создать заявку" }).click();
    await expect(page.getByText("Укажите имя, минимум 2 символа")).toBeVisible();
    await expect(page.getByText("Выберите услугу")).toHaveCount(2); // option + message

    const n = uniq();
    await page.getByLabel("Имя", { exact: true }).fill(`Звонок ${n}`);
    await page.getByLabel("Телефон").fill("8 916 555-12-34");
    await page.getByLabel("Email").fill("broken");
    await page.getByLabel("Услуга").selectOption("support");
    await page.getByRole("button", { name: "Создать заявку" }).click();
    await expect(page.getByText("Проверьте адрес почты")).toBeVisible();

    await page.getByLabel("Имя", { exact: true }).fill(`Звонок ${n}`);
    await page.getByLabel("Телефон").fill("8 916 555-12-34");
    await page.getByLabel("Email").fill("");
    await page.getByLabel("Услуга").selectOption("support");
    await page.getByLabel("Комментарий").fill("Звонок на горячую линию");
    await page.getByRole("button", { name: "Создать заявку" }).dblclick();

    await expect(page).toHaveURL(/\/admin\/leads\/lead-[0-9a-f]+/);
    await expect(page.getByText("Заявка создана", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: `Звонок ${n}` })).toBeVisible();
    await expect(page.getByText("Создана вручную").first()).toBeVisible();

    const found = dbAll("SELECT id, source, email, phone FROM leads WHERE name = ?", `Звонок ${n}`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: "manual", email: "", phone: "+79165551234" });
    await waitForSyncStatus(found[0].id as string, "synced");

    await page.goto(`/admin/leads?q=${n}&source=manual`);
    await expect(rows(page)).toHaveCount(1);

    // a lead known only by phone is its own client, not merged into a nameless "no e-mail" client
    await page.goto("/admin/clients");
    const client = page.locator("tbody tr").filter({ hasText: `Звонок ${n}` });
    await expect(client).toHaveCount(1);
    await expect(client).toContainText("без почты");
  });
});
