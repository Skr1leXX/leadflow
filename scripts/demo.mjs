// Starts a self-contained demo of LeadFlow: production build, fictional data, demo accounts, simulated Bitrix24.
// Usage: npm run build && npm run demo      (then open http://localhost:3000)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync(".next/BUILD_ID")) {
  console.error("Нет production-сборки. Сначала выполните: npm run build");
  process.exit(1);
}

const port = process.env.PORT || "3000";
const env = {
  ...process.env,
  NODE_ENV: "production",
  LEADFLOW_DEMO: "true",
  LEADFLOW_SHOW_DEMO_LOGINS: "true",
  LEADFLOW_DEMO_PASSWORD: process.env.LEADFLOW_DEMO_PASSWORD || "leadflow-demo",
  LEADFLOW_ADMIN_PASSWORD: process.env.LEADFLOW_ADMIN_PASSWORD || process.env.LEADFLOW_DEMO_PASSWORD || "leadflow-demo",
  // Not a secret worth protecting: it only signs sessions of a throw-away demo database.
  LEADFLOW_SESSION_SECRET: process.env.LEADFLOW_SESSION_SECRET || "leadflow-demo-session-secret-not-for-real-use",
  LEADFLOW_DB_PATH: process.env.LEADFLOW_DB_PATH || "data/demo.db",
  BITRIX24_MODE: "demo",
  // A real webhook must never be picked up by the demo, even if one is set in the shell.
  BITRIX24_WEBHOOK_URL: "",
};

console.log(`LeadFlow demo: http://localhost:${port}  (база: ${env.LEADFLOW_DB_PATH}, сброс: npm run demo:reset)`);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
