import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import type { IntegrationMode } from "@/features/bitrix/client";

/**
 * The admin panel has no sign-in yet, so these endpoints are closed in live mode unless the caller
 * sends `Authorization: Bearer <LEADFLOW_API_TOKEN>`. Demo mode touches no real portal and stays open.
 */
export function guardApi(request: Request, mode: IntegrationMode): NextResponse | null {
  if (mode === "demo") return null;
  const expected = process.env.LEADFLOW_API_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json({ ok: false, message: "LEADFLOW_API_TOKEN не задан: в боевом режиме API закрыт" }, { status: 503 });
  }
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, message: "Нет доступа" }, { status: 401 });
  }
  return null;
}
