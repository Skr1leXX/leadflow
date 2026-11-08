import { NextResponse } from "next/server";
import { runDueRetries, getSettings } from "@/features/leads/service";
import { guardApi } from "../../bitrix/guard";

/** Runs one retry pass now. For an external scheduler (cron) when the in-process worker is not an option. */
export async function POST(request: Request) {
  const denied = guardApi(request, getSettings().mode);
  if (denied) return denied;
  return NextResponse.json({ ok: true, processed: await runDueRetries() });
}
