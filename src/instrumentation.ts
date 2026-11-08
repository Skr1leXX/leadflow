/**
 * Starts the background retry pass once per server process. It needs a long-running Node server. On Vercel there is none
 * (functions live for one request), so retries run from a cron job that calls /api/sync/run instead; see vercel.json.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL) return;
  const g = globalThis as typeof globalThis & { __leadflowWorker?: boolean };
  if (g.__leadflowWorker) return;
  g.__leadflowWorker = true;

  const { runDueRetries } = await import("@/features/leads/service");
  setInterval(() => {
    runDueRetries().catch((e) => console.error("retry worker failed", e instanceof Error ? e.message : e));
  }, 30_000).unref();
}
