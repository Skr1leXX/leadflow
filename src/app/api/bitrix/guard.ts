import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import type { IntegrationMode } from "@/features/bitrix/client";

/**
 * The admin panel has no sign-in yet, so these endpoints are closed in live mode unless the caller
 * sends `Authorization: Bearer <LEADFLOW_API_TOKEN>`. Demo mode touches no real portal and stays open.
 */
export function guardApi(request: Request, mode: IntegrationMode): NextResponse | null {
  if (mode === "demo") return null;
  // LEADFLOW_API_TOKEN for our own callers; CRON_SECRET is what Vercel Cron sends as its Bearer token.
  const accepted = [process.env.LEADFLOW_API_TOKEN, process.env.CRON_SECRET].map((t) => t?.trim()).filter((t): t is string => !!t);
  if (accepted.length === 0) {
    return NextResponse.json({ ok: false, message: "LEADFLOW_API_TOKEN не задан: в боевом режиме API закрыт" }, { status: 503 });
  }
  const a = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const matches = accepted.some((t) => {
    const b = Buffer.from(t);
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!matches) {
    return NextResponse.json({ ok: false, message: "Нет доступа" }, { status: 401 });
  }
  return null;
}
