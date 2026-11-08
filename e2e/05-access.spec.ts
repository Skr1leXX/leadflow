import { test, expect } from "./fixtures";
import { AUTH, E2E, MANAGER_A, MANAGER_B, createLead, dbAll, dbGet, leadRow, login, uniq, waitForSyncStatus } from "./helpers";

const ADMIN_ONLY = ["/admin/settings", "/admin/automation", "/admin/staff", "/admin/integration", "/admin/sync-log"];

test.describe("anonymous visitors", () => {
  test("every admin page sends them to the login page and remembers where they wanted to go", async ({ page }) => {
    for (const path of ["/admin", "/admin/leads", "/admin/leads/new", "/admin/sync-log", "/admin/settings", "/admin/leads/lead-001"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      await expect(page.getByRole("heading", { name: "Вход в панель управления" })).toBeVisible();
    }
  });

  test("no admin data is served to them", async ({ request }) => {
    for (const path of ["/admin", "/admin/leads", "/admin/sync-log"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      const body = await res.text();
      expect(body).not.toContain("Заявки с сайта");
      expect(body).not.toContain("@example.com");
    }
  });

  test("a forged or tampered session cookie is not accepted", async ({ browser }) => {
    const forged = Buffer.from(JSON.stringify({ sid: "staff-admin", exp: 9_999_999_999_999 })).toString("base64url");
    for (const value of [`${forged}.AAAA`, forged, "garbage", `${forged}.${"A".repeat(43)}`]) {
      const ctx = await browser.newContext({ storageState: { cookies: [{ name: "lf_session", value, domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] } });
      const page = await ctx.newPage();
      await page.goto("/admin/leads");
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("heading", { name: "Вход в панель управления" })).toBeVisible();
      await ctx.close();
    }
  });

  test("a valid token with a changed payload is rejected", async ({ browser }) => {
    const real = JSON.parse((await import("node:fs")).readFileSync(AUTH.anna, "utf8")).cookies[0].value as string;
    const [, sig] = real.split(".");
    const asAdmin = Buffer.from(JSON.stringify({ sid: "staff-admin", exp: 9_999_999_999_999 })).toString("base64url");
    const ctx = await browser.newContext({ storageState: { cookies: [{ name: "lf_session", value: `${asAdmin}.${sig}`, domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/admin/staff");
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });
});

test.describe("signing in", () => {
  test("wrong password and unknown account give the same message and no session", async ({ page }) => {
    await login(page, E2E.adminEmail, "wrong-password");
    await expect(page.getByText("Неверная почта или пароль")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await login(page, "nobody@example.com", "wrong-password");
    await expect(page.getByText("Неверная почта или пароль")).toBeVisible();
    expect((await page.context().cookies()).some((c) => c.name === "lf_session")).toBe(false);
  });

  test("the session cookie is HttpOnly and Secure, and a successful sign-in lands on the requested page", async ({ page }) => {
    await page.goto("/admin/sync-log");
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Почта").fill(E2E.adminEmail);
    await page.getByLabel("Пароль").fill(E2E.adminPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(/\/admin\/sync-log$/);
    const cookie = (await page.context().cookies()).find((c) => c.name === "lf_session");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the redirect target after sign-in cannot leave the admin panel", async ({ page }) => {
    for (const next of ["//evil.example/x", "https://evil.example", "/api/leads", "/login"]) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel("Почта").fill(E2E.adminEmail);
      await page.getByLabel("Пароль").fill(E2E.adminPassword);
      await page.getByRole("button", { name: "Войти" }).click();
      await expect(page).toHaveURL(/localhost:3200\/admin$/);
      await page.getByRole("button", { name: "Выйти" }).click();
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("password guessing is throttled", async ({ page }) => {
    const email = `guess-${uniq()}@example.com`;
    for (let i = 0; i < 9; i++) {
      await page.goto("/login");
      await page.getByLabel("Почта").fill(email);
      await page.getByLabel("Пароль").fill(`bad-${i}`);
      await page.getByRole("button", { name: "Войти" }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
    }
    await expect(page.getByText(/Слишком много попыток/)).toBeVisible();
  });
});

test.describe("manager permissions", () => {
  test.use({ storageState: AUTH.anna });

  test("sees only dashboard, leads and clients", async ({ page }) => {
    await page.goto("/admin");
    const links = await page.getByRole("navigation", { name: "Разделы" }).first().getByRole("link").allInnerTexts();
    expect(links.map((l) => l.trim())).toEqual(["Dashboard", "Заявки", "Клиенты"]);
    await expect(page.getByText(MANAGER_A.name).first()).toBeVisible();
  });

  for (const path of ADMIN_ONLY) {
    test(`is refused ${path} and sees no data from it`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Недостаточно прав" })).toBeVisible();
      await expect(page.locator("main")).not.toContainText("@example.com");
      await expect(page.locator("main table")).toHaveCount(0);
    });
  }

  test("is refused a journal entry by direct link", async ({ page }) => {
    const entry = dbGet("SELECT id FROM sync_events LIMIT 1")!.id as string;
    await page.goto(`/admin/sync-log/${entry}`);
    await expect(page.getByRole("heading", { name: "Недостаточно прав" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("crm.lead");
  });

  test("the admin banner link is not offered to managers", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText("Демонстрационный режим")).toBeVisible();
    await expect(page.getByRole("link", { name: "Настроить" })).toHaveCount(0);
  });

  test("takes an unassigned lead, works on it, and a colleague then cannot change it, even by forcing the request", async ({ browser, request }) => {
    const { id } = await createLead(request);
    await waitForSyncStatus(id, "synced");

    const anna = await browser.newContext({ storageState: AUTH.anna });
    const ap = await anna.newPage();
    await ap.goto(`/admin/leads/${id}`);
    await ap.locator("#lead-assignee").selectOption({ label: MANAGER_A.name });
    await expect(ap.getByText("Ответственный назначен")).toBeVisible();
    await ap.locator("#lead-status").selectOption("in_progress");
    await expect(ap.getByText("Статус обновлён")).toBeVisible();
    await anna.close();
    const owner = leadRow(id)?.assignee_id;
    expect(owner).toBeTruthy();

    const boris = await browser.newContext({ storageState: AUTH.boris });
    const bp = await boris.newPage();
    await bp.goto(`/admin/leads/${id}`);
    await expect(bp.getByRole("heading").first()).toBeVisible();
    for (const sel of ["#lead-status", "#lead-assignee", "#comment"]) await expect(bp.locator(sel)).toBeDisabled();
    await expect(bp.getByText("Заявка закреплена за другим сотрудником")).toBeVisible();
    await expect(bp.getByRole("button", { name: "Добавить комментарий" })).toBeDisabled();

    // Bypass the disabled controls: call the same handlers the page uses. The server must still refuse.
    const refusals = await bp.evaluate(async () => {
      const call = async (id: string, value: string) => {
        const el = document.getElementById(id) as HTMLElement;
        const key = Object.keys(el).find((k) => k.startsWith("__reactProps"))!;
        (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key].onChange({ target: { value } });
        await new Promise((r) => setTimeout(r, 1500));
        return [...document.querySelectorAll("[role=alert]")].map((e) => (e as HTMLElement).innerText).join(" | ");
      };
      return [await call("lead-status", "won"), await call("lead-assignee", "")];
    });
    for (const r of refusals) expect(r).toContain("закреплена за другим сотрудником");
    expect(leadRow(id)).toMatchObject({ status: "in_progress", assignee_id: owner });
    expect(dbAll("SELECT kind FROM lead_timeline WHERE lead_id = ?", id).map((t) => t.kind).sort()).toEqual(["assignee", "status"]);
    await boris.close();
  });

  test("a manager creating a lead can only assign it to themselves", async ({ page }) => {
    await page.goto("/admin/leads/new");
    const options = await page.locator("#assigneeId option").allInnerTexts();
    expect(options).toEqual([MANAGER_A.name]);
    expect(options).not.toContain(MANAGER_B.name);
  });
});

test.describe("administrator", () => {
  test.use({ storageState: AUTH.admin });

  test("can open every admin area and change any lead", async ({ page, request }) => {
    for (const path of ADMIN_ONLY) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Недостаточно прав" })).toHaveCount(0);
      await expect(page.locator("main h1").first()).toBeVisible();
    }
    const { id } = await createLead(request);
    await page.goto(`/admin/leads/${id}`);
    await page.locator("#lead-assignee").selectOption({ label: MANAGER_B.name });
    await expect(page.getByText("Ответственный назначен")).toBeVisible();
    await page.locator("#lead-status").selectOption("rejected");
    await expect(page.getByText("Статус обновлён")).toBeVisible();
    expect(leadRow(id)?.status).toBe("rejected");
  });

  test("a deactivated employee cannot sign in, and an active session stops working", async ({ page, browser }) => {
    const email = `temp-${uniq()}@e2e.test`;
    await page.goto("/admin/staff");
    await page.getByLabel("Имя", { exact: true }).fill("Временный Сотрудник");
    await page.getByLabel("Почта (логин)").fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(E2E.managerPassword);
    await page.getByRole("button", { name: "Добавить сотрудника" }).click();
    await expect(page.getByText("Сотрудник добавлен")).toBeVisible();

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } }); // not the administrator's session
    const tp = await ctx.newPage();
    await login(tp, email, E2E.managerPassword);
    await expect(tp).toHaveURL(/\/admin$/);

    await page.reload();
    await page.getByRole("switch", { name: /Временный Сотрудник: включён/ }).click();
    await expect(page.getByText("Сотрудник отключён")).toBeVisible();

    await tp.goto("/admin/leads");
    await expect(tp).toHaveURL(/\/login/);
    await login(tp, email, E2E.managerPassword);
    await expect(tp.getByText("Неверная почта или пароль")).toBeVisible();
    await ctx.close();
  });

  test("cannot deactivate themselves", async ({ page }) => {
    await page.goto("/admin/staff");
    await expect(page.getByRole("switch", { name: /Администратор: включён/ })).toBeDisabled();
  });

  test("staff form refuses short passwords and duplicate e-mails", async ({ page }) => {
    await page.goto("/admin/staff");
    await page.getByLabel("Имя", { exact: true }).fill("Тест");
    await page.getByLabel("Почта (логин)").fill("short@e2e.test");
    await page.getByLabel("Пароль", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Добавить сотрудника" }).click();
    await expect(page.getByText("Пароль: минимум 10 символов")).toBeVisible();

    await page.getByLabel("Имя", { exact: true }).fill("Дубль");
    await page.getByLabel("Почта (логин)").fill(MANAGER_A.email.toUpperCase());
    await page.getByLabel("Пароль", { exact: true }).fill(E2E.managerPassword);
    await page.getByRole("button", { name: "Добавить сотрудника" }).click();
    await expect(page.getByText("Сотрудник с такой почтой уже есть")).toBeVisible();
  });
});

test.describe("API access", () => {
  test("the Bitrix24 endpoints expose no secrets and the call endpoint refuses in demo mode", async ({ request }) => {
    const status = await request.get("/api/bitrix/status");
    expect(status.status()).toBe(200);
    expect(await status.json()).toEqual({ ok: true, mode: "demo", state: "demo", host: null, webhookConfigured: true });
    const check = await request.post("/api/bitrix/check");
    expect(check.status()).toBe(200);
    expect((await check.json()).info).toMatchObject({ demo: true, portal: "demo.bitrix24.ru" });
    const call = await request.post("/api/bitrix/call", { data: { method: "profile" } });
    expect(call.status()).toBe(409);
    for (const r of [status, check, call]) expect(await r.text()).not.toContain(E2E.webhookCode);
  });

  test("the retry endpoint answers with a count and nothing else", async ({ request }) => {
    const res = await request.post("/api/sync/run");
    expect(res.status()).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(["ok", "processed"]);
  });
});
