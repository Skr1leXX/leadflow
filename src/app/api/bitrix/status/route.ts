import { connection, NextResponse } from "next/server";
import { getIntegrationStatus } from "@/features/bitrix/integration";
import { getSettings } from "@/features/leads/service";
import { guardApi } from "../guard";

/** Mode, state and portal host. Never returns the webhook URL. */
export async function GET(request: Request) {
  await connection(); // mode and env are per-request state; without this the route is prerendered at build time
  const mode = (await getSettings()).mode;
  const denied = guardApi(request, mode);
  if (denied) return denied;
  return NextResponse.json({ ok: true, ...getIntegrationStatus(mode) });
}
