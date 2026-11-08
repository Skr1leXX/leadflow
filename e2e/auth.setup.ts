import { expect, test as setup } from "./fixtures";
import { AUTH, E2E, MANAGER_A, MANAGER_B, login } from "./helpers";

// Signs in once per run and saves the sessions. Managers do not exist in production mode, so the administrator creates them
// through the Staff page, which also exercises that page.

setup("administrator signs in", async ({ page }) => {
  await login(page, E2E.adminEmail, E2E.adminPassword);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.context().storageState({ path: AUTH.admin });
});

for (const [key, m] of [["anna", MANAGER_A], ["boris", MANAGER_B]] as const) {
  setup(`administrator creates manager ${m.name} who can sign in`, async ({ browser }) => {
    const admin = await browser.newContext({ storageState: AUTH.admin });
    const page = await admin.newPage();
    await page.goto("/admin/staff");
    await page.getByLabel("Имя", { exact: true }).fill(m.name);
    await page.getByLabel("Почта (логин)").fill(m.email);
    await page.getByLabel("Пароль", { exact: true }).fill(E2E.managerPassword);
    await page.getByLabel("ID пользователя в Битрикс24").fill(key === "anna" ? "21" : "22");
    await page.getByRole("button", { name: "Добавить сотрудника" }).click();
    await expect(page.getByText("Сотрудник добавлен")).toBeVisible();
    await expect(page.getByText(m.email)).toBeVisible();
    await admin.close();

    const ctx = await browser.newContext();
    const mp = await ctx.newPage();
    await login(mp, m.email, E2E.managerPassword);
    await expect(mp).toHaveURL(/\/admin$/);
    await ctx.storageState({ path: AUTH[key] });
    await ctx.close();
  });
}
