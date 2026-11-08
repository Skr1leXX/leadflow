import { after, NextResponse } from "next/server";
import { parseLeadInput, submissionMetaSchema } from "@/features/leads/schema";
import { createLead, getSettings, syncLeadNow } from "@/features/leads/service";
import { createRateLimiter, judgeSubmission } from "@/features/leads/spam";

const MAX_BODY_BYTES = 8_000;
const limiter = createRateLimiter(8, 10 * 60_000);

const fail = (status: number, message: string, extra: Record<string, unknown> = {}, headers?: HeadersInit) =>
  NextResponse.json({ ok: false, message, ...extra }, { status, headers });

// shortcut: the limiter keys on x-forwarded-for, which a client can spoof unless a trusted proxy overwrites it; put it behind one before going public.
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail(413, "Слишком большой запрос");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "Некорректный запрос");
  }

  const meta = submissionMetaSchema.safeParse(body);
  if (!meta.success) return fail(400, "Некорректный запрос");

  const verdict = judgeSubmission(meta.data, Date.now());
  // Bots get a normal-looking answer and nothing is stored, so they learn nothing about what tripped the check.
  if (verdict === "honeypot") return NextResponse.json({ ok: true, id: "accepted", duplicate: false }, { status: 201 });
  if (verdict === "too_fast") return fail(422, "Форма отправлена слишком быстро. Проверьте данные и нажмите «Отправить» ещё раз.");

  const parsed = parseLeadInput(body);
  if (!parsed.ok) return fail(422, "Проверьте заполнение формы", { errors: parsed.errors });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const wait = limiter.hit(ip, Date.now());
  if (wait > 0) return fail(429, "Слишком много заявок. Попробуйте чуть позже.", {}, { "Retry-After": String(wait) });

  const { lead, duplicate } = createLead(parsed.data, meta.data.idempotencyKey);

  // The lead is already saved. Sending to Bitrix24 happens after the response, and a failure there never loses it.
  if (!duplicate && getSettings().autoSync) {
    after(() => syncLeadNow(lead.id).catch((e) => console.error("lead sync crashed", lead.id, e instanceof Error ? e.message : e)));
  }
  return NextResponse.json({ ok: true, id: lead.id, duplicate }, { status: duplicate ? 200 : 201 });
}
