import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
/** A second server started like a real deployment: no demo opt-in, so it begins with an empty database. */
const EMPTY_PORT = 3201;

// One database per run. The id is created by the main process and inherited by the workers, so only the main process
// cleans up old runs; a worker re-reading this file must never delete the database that is in use.
if (!process.env.E2E_RUN_ID) {
  process.env.E2E_RUN_ID = String(Date.now());
  try {
    for (const f of readdirSync("data/e2e")) rmSync(`data/e2e/${f}`, { force: true });
  } catch {
    // first run: nothing to clean
  }
  mkdirSync("data/e2e", { recursive: true });
}

export const E2E = {
  emptyUrl: `http://localhost:${EMPTY_PORT}`,
  dbPath: `data/e2e/${process.env.E2E_RUN_ID}.db`,
  adminEmail: "admin@example.com",
  adminPassword: "E2eAdmin!pass-123",
  managerPassword: "E2eManager!pass-123",
  apiToken: "e2e-api-token-0123456789abcdef",
  sessionSecret: "e2e-session-secret-0123456789abcdef",
  /** A fake webhook whose access code must never appear anywhere: pages, API answers, scripts, the journal. */
  webhookCode: "SECRETCODE9f3a1b7c",
  webhookUrl: "https://leak-test.invalid/rest/1/SECRETCODE9f3a1b7c/",
};

export default defineConfig({
  testDir: "e2e",
  // The suite shares one server and one database, and some specs change global state (mode, staff), so it runs in order.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome", // the Chrome installed on the machine: no browser download needed
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      testIgnore: [/auth\.setup\.ts/, /\.mobile\.spec\.ts/, /08-empty\.spec\.ts/],
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
      dependencies: ["setup"],
    },
    {
      name: "empty",
      testMatch: /08-empty\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel: "chrome", baseURL: `http://localhost:${EMPTY_PORT}` },
    },
    {
      name: "mobile",
      testMatch: /\.mobile\.spec\.ts/,
      use: { ...devices["Pixel 7"], channel: "chrome" },
      dependencies: ["setup"],
    },
  ],
  // Production build: it behaves like a real deployment (no demo accounts, secure cookies). `npm run e2e` builds first.
  webServer: [
    {
      command: `npm run start -- -p ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        BITRIX24_MODE: "demo",
        BITRIX24_WEBHOOK_URL: E2E.webhookUrl,
        LEADFLOW_API_TOKEN: E2E.apiToken,
        LEADFLOW_SESSION_SECRET: E2E.sessionSecret,
        LEADFLOW_ADMIN_PASSWORD: E2E.adminPassword,
        LEADFLOW_DB_PATH: E2E.dbPath,
        // Opt in to the fictional demo leads (but no demo managers: those are created through the UI in the setup project).
        LEADFLOW_DEMO: "true",
      },
    },
    {
      command: `npm run start -- -p ${EMPTY_PORT}`,
      url: `http://localhost:${EMPTY_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        BITRIX24_MODE: "demo",
        BITRIX24_WEBHOOK_URL: "",
        LEADFLOW_API_TOKEN: E2E.apiToken,
        LEADFLOW_SESSION_SECRET: E2E.sessionSecret,
        LEADFLOW_ADMIN_PASSWORD: E2E.adminPassword,
        LEADFLOW_DB_PATH: `data/e2e/${process.env.E2E_RUN_ID}-empty.db`,
        LEADFLOW_DEMO: "",
      },
    },
  ],
});
