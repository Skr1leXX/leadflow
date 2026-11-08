// Takes the screenshots used in README.md and docs/DEMO.md from a running demo (npm run demo).
// Usage: npm run demo   (in one terminal)   then   npm run screenshots   (in another)
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.DEMO_URL || "http://localhost:3000";
const out = "docs/screenshots";
mkdirSync(out, { recursive: true });

// Uses the Chrome installed on the machine, so no browser download is needed.
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU", timezoneId: "Europe/Moscow" });
const page = await context.newPage();

const shot = async (name, path, { fullPage = false, wait } = {}) => {
  await page.goto(`${base}${path}`);
  await page.waitForLoadState("networkidle");
  if (wait) await page.locator(wait).first().waitFor();
  await page.waitForTimeout(600); // let charts finish animating
  await page.screenshot({ path: `${out}/${name}.png`, fullPage });
  console.log("saved", `${out}/${name}.png`);
};

await shot("login", "/login", { wait: "[data-testid=demo-logins]" });

await page.getByLabel("Почта").fill("admin@example.com");
await page.getByLabel("Пароль").fill(process.env.LEADFLOW_DEMO_PASSWORD || "leadflow-demo");
await page.getByRole("button", { name: "Войти" }).click();
await page.waitForURL(`${base}/admin`);

await shot("dashboard", "/admin?period=month", { fullPage: true, wait: "[data-testid=kpis]" });
await shot("leads", "/admin/leads", { wait: "tbody tr" });
await shot("lead-card", "/admin/leads/lead-038", { fullPage: true, wait: "#lead-status" });
await shot("sync-log", "/admin/sync-log", { wait: "tbody tr" });
await shot("automation", "/admin/automation", { wait: "[role=switch]" });
await shot("integration", "/admin/integration", { fullPage: true, wait: "text=Подключение" });

await page.setViewportSize({ width: 390, height: 844 });
await shot("mobile-dashboard", "/admin?period=week", { wait: "[data-testid=kpis]" });
await shot("mobile-leads", "/admin/leads", { wait: "tbody tr" });

await browser.close();
