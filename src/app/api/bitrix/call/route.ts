import { NextResponse } from "next/server";
import { z } from "zod";
import { BitrixError } from "@/features/bitrix/client";
import { readBitrixEnv } from "@/features/bitrix/config";
import { CALLABLE_METHODS } from "@/features/bitrix/integration";
import { RealBitrixClient } from "@/features/bitrix/real-client";
import { getSettings } from "@/features/leads/service";
import { guardApi } from "../guard";

const bodySchema = z.object({
  method: z.enum(CALLABLE_METHODS, "Метод не разрешён"),
  params: z.record(z.string(), z.unknown()).default({}),
});

/** Runs one allow-listed, read-only REST method on the real portal. Demo mode has no portal, so it answers 409. */
export async function POST(request: Request) {
  const { mode } = getSettings();
  const denied = guardApi(request, mode);
  if (denied) return denied;

  if (mode === "demo") {
    return NextResponse.json({ ok: false, message: "Демонстрационный режим: реального портала нет, запрос не выполнялся" }, { status: 409 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Некорректный запрос", allowed: CALLABLE_METHODS }, { status: 400 });
  }

  const { webhookUrl } = readBitrixEnv();
  if (!webhookUrl) {
    return NextResponse.json({ ok: false, code: "NOT_CONFIGURED", message: "BITRIX24_WEBHOOK_URL не задан или имеет неверный формат" }, { status: 503 });
  }

  try {
    const result = await new RealBitrixClient({ webhookUrl }).call(parsed.data.method, parsed.data.params);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const err = e instanceof BitrixError ? e : new BitrixError("Неизвестная ошибка", "UNKNOWN");
    return NextResponse.json({ ok: false, code: err.code, message: err.message }, { status: err.code === "TIMEOUT" ? 504 : 502 });
  }
}
