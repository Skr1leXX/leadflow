/** Starts the background retry pass once per server process. Needs a long-running Node server (not serverless). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as typeof globalThis & { __leadflowWorker?: boolean };
  if (g.__leadflowWorker) return;
  g.__leadflowWorker = true;

  const { runDueRetries } = await import("@/features/leads/service");
  setInterval(() => {
    runDueRetries().catch((e) => console.error("retry worker failed", e instanceof Error ? e.message : e));
  }, 30_000).unref();
}
