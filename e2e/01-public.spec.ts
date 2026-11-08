import { test, expect } from "./fixtures";
import { leadBody, leadRow, leadsByEmail, postLead, randomIp, uniq, waitForSyncStatus, dbAll } from "./helpers";

test.describe("public site and lead form", () => {
  test("the public site opens with the form and a link to the panel", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/LeadFlow/);
    await expect(page.getByRole("heading", { level: 1, name: "Оставьте заявку" })).toBeVisible();
    for (const label of ["Имя", "Телефон", "Email", "Услуга", "Комментарий"]) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Отправить заявку" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Панель управления" })).toHaveAttribute("href", "/admin");
  });

  test("required fields are validated in the browser and nothing is sent", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/leads", (route) => (requests++, route.continue()));
    await page.goto("/");
    await page.getByRole("button", { name: "Отправить заявку" }).click();

    await expect(page.getByText("Укажите имя, минимум 2 символа")).toBeVisible();
    await expect(page.getByText("Введите телефон в формате +7 900 123-45-67")).toBeVisible();
    await expect(page.getByText("Проверьте адрес почты")).toBeVisible();
    await expect(page.locator("#serviceId-error")).toHaveText("Выберите услугу");
    await expect(page.getByLabel("Имя", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(requests).toBe(0);
  });

  test("a malformed phone and email get their own messages", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Имя", { exact: true }).fill("Иван");
    await page.getByLabel("Телефон").fill("12345");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Услуга").selectOption("automation");
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByText("Введите телефон в формате")).toBeVisible();
    await expect(page.getByText("Проверьте адрес почты")).toBeVisible();
    await expect(page.getByText("Укажите имя")).toHaveCount(0);
  });

  test("a valid submission is saved in the database and sent to the demo Bitrix24", async ({ page }) => {
    const n = uniq();
    const email = `form-${n}@example.com`;
    await page.goto("/");
    await page.getByLabel("Имя", { exact: true }).fill(`Заявитель ${n}`);
    await page.getByLabel("Телефон").fill("8 (900) 111-22-33");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Услуга").selectOption("crm-integration");
    await page.getByLabel("Комментарий").fill("Нужна интеграция сайта с CRM");
    await page.waitForTimeout(2100); // the form refuses submissions faster than a person could type
    await page.getByRole("button", { name: "Отправить заявку" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Заявка принята" })).toBeVisible();
    await expect(page.getByText("Менеджер свяжется с вами")).toBeVisible();

    const rows = leadsByEmail(email);
    expect(rows).toHaveLength(1);
    const lead = rows[0];
    expect(lead).toMatchObject({ name: `Заявитель ${n}`, phone: "+79001112233", service_id: "crm-integration", comment: "Нужна интеграция сайта с CRM", source: "website", status: "new", demo_data: 0 });

    await waitForSyncStatus(lead.id as string, "synced");
    expect(leadRow(lead.id as string)).toMatchObject({ sync_demo: 1, sync_attempts: 1 });
    expect(leadRow(lead.id as string)?.bitrix_lead_id, "demo ID is stored but flagged demo").toBeTruthy();
  });

  test("a double click on submit creates exactly one lead", async ({ page }) => {
    const email = `dbl-${uniq()}@example.com`;
    await page.goto("/");
    await page.getByLabel("Имя", { exact: true }).fill("Двойной клик");
    await page.getByLabel("Телефон").fill("+7 900 222-33-44");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Услуга").selectOption("support");
    await page.waitForTimeout(2100);
    await page.getByRole("button", { name: "Отправить заявку" }).dblclick();
    await expect(page.getByText("Заявка принята")).toBeVisible();
    await page.waitForTimeout(500);
    expect(leadsByEmail(email)).toHaveLength(1);
  });

  test("a server error is shown, the input is kept and a retry succeeds without duplicates", async ({ page }) => {
    const email = `retry-${uniq()}@example.com`;
    let mode: "fail500" | "network" | "pass" = "fail500";
    await page.route("**/api/leads", (route) => {
      if (mode === "fail500") return route.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false}' });
      if (mode === "network") return route.abort("failed");
      return route.continue();
    });
    await page.goto("/");
    await page.getByLabel("Имя", { exact: true }).fill("Сбой сети");
    await page.getByLabel("Телефон").fill("+7 900 333-44-55");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Услуга").selectOption("analytics");
    await page.waitForTimeout(2100);

    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Сервис временно недоступен" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByText("Заявка принята")).toHaveCount(0);

    mode = "network";
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Нет связи с сервером" })).toBeVisible();

    mode = "pass";
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByText("Заявка принята")).toBeVisible();
    expect(leadsByEmail(email)).toHaveLength(1);
  });

  test("a validation error from the server is shown on the field", async ({ page }) => {
    await page.route("**/api/leads", (route) =>
      route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ ok: false, message: "Проверьте заполнение формы", errors: { email: "Адрес почты уже занят" } }) }),
    );
    await page.goto("/");
    await page.getByLabel("Имя", { exact: true }).fill("Сервер против");
    await page.getByLabel("Телефон").fill("+7 900 444-55-66");
    await page.getByLabel("Email").fill("ok@example.com");
    await page.getByLabel("Услуга").selectOption("support");
    await page.waitForTimeout(2100);
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByText("Адрес почты уже занят")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Проверьте заполнение формы" })).toBeVisible();
  });
});

test.describe("lead API: errors and abuse protection", () => {
  const post = (request: import("@playwright/test").APIRequestContext, data: unknown, ip = randomIp(), raw = false) =>
    request.post("/api/leads", { headers: { "x-forwarded-for": ip, ...(raw ? { "content-type": "application/json" } : {}) }, ...(raw ? { data: data as string } : { data }) });

  test("malformed JSON and missing form fields are rejected with 400", async ({ request }) => {
    expect((await post(request, "{not json", randomIp(), true)).status()).toBe(400);
    expect((await post(request, "[]", randomIp(), true)).status()).toBe(400);
    expect((await post(request, { name: "x" })).status()).toBe(400);
  });

  test("invalid lead data gets 422 with a message per field", async ({ request }) => {
    const res = await post(request, leadBody({ name: "A", phone: "12", email: "nope", serviceId: "unknown" }));
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(Object.keys(body.errors).sort()).toEqual(["email", "name", "phone", "serviceId"]);
    expect(body.errors.name).toMatch(/минимум 2/);
  });

  test("a submission faster than a person, and one without a timestamp, is refused", async ({ request }) => {
    const fast = await post(request, leadBody({ startedAt: Date.now() - 300 }));
    expect(fast.status()).toBe(422);
    expect((await fast.json()).message).toMatch(/слишком быстро/);
    const { startedAt, ...noStamp } = leadBody();
    void startedAt;
    expect((await post(request, noStamp)).status()).toBe(422);
  });

  test("the honeypot gets a normal-looking answer and stores nothing", async ({ request }) => {
    const email = `bot-${uniq()}@example.com`;
    const res = await post(request, leadBody({ email, website: "http://spam.example" }));
    expect(res.status()).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, id: "accepted" });
    expect(leadsByEmail(email)).toHaveLength(0);
  });

  test("an oversized body is refused with 413", async ({ request }) => {
    const res = await post(request, leadBody({ comment: "x".repeat(9000) }));
    expect(res.status()).toBe(413);
  });

  test("repeating a submission key or the same content returns the original lead", async ({ request }) => {
    const first = await postLead(request);
    expect(first.res.status()).toBe(201);
    const again = await postLead(request, { ...first.body });
    expect(again.res.status()).toBe(200);
    expect(again.json).toMatchObject({ duplicate: true, id: first.json!.id });

    const sameContent = await postLead(request, { ...first.body, idempotencyKey: `other-${uniq()}-abcdef` });
    expect(sameContent.json).toMatchObject({ duplicate: true, id: first.json!.id });
    expect(leadsByEmail(first.body.email)).toHaveLength(1);
  });

  test("one client is rate limited after eight submissions and others are not", async ({ request }) => {
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await postLead(request, {}, ip)).res.status());
    expect(statuses.slice(0, 8).every((s) => s === 201)).toBe(true);
    expect(statuses[8]).toBe(429);
    const limited = await postLead(request, {}, ip);
    expect(Number(limited.res.headers()["retry-after"])).toBeGreaterThan(0);
    expect((await postLead(request, {}, randomIp())).res.status()).toBe(201);
  });

  test("a lead is saved even when Bitrix24 fails, and the error is kept", async ({ request }) => {
    const { json, body } = await postLead(request, { email: `err-${uniq()}@bitrix-error.test` });
    expect(json?.ok).toBe(true);
    await waitForSyncStatus(json!.id!, "failed");
    expect(leadsByEmail(body.email)).toHaveLength(1);
    expect(leadRow(json!.id!)).toMatchObject({ sync_error_code: "QUERY_LIMIT_EXCEEDED", bitrix_lead_id: null, sync_attempts: 1 });
    expect(dbAll("SELECT ok FROM sync_events WHERE lead_id = ?", json!.id!).map((e) => e.ok)).toEqual([0]);
  });
});
