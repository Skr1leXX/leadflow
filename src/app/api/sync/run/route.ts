import { NextResponse } from "next/server";
import { getSettings, runDueRetries } from "@/features/leads/service";
import { guardApi } from "../../bitrix/guard";

/**
 * Runs one retry pass now. On a normal server the built-in worker does this every 30 seconds; on Vercel this endpoint is the
 * only way retries happen, called by Vercel Cron (GET, with CRON_SECRET as the Bearer token) or any external scheduler.
 */
async function run(request: Request) {
  const denied = guardApi(request, (await getSettings()).mode);
  if (denied) return denied;
  return NextResponse.json({ ok: true, processed: await runDueRetries() });
}

export const GET = run;
export const POST = run;
