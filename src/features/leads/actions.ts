"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEditLead, canManageIntegration, canManageRules, canManageStaff, type Actor } from "@/features/auth/permissions";
import { getCurrentUser } from "@/features/auth/session";
import { hashPassword } from "@/features/auth/password";
import { getIntegrationStatus, type ConnectionReport } from "@/features/bitrix/integration";
import { getDb } from "./db";
import { DEFAULT_STATUS_MAP } from "./defaults";
import { manualLeadSchema } from "./schema";
import * as service from "./service";
import * as wf from "./repo-workflow";
import { LEAD_STATUSES, RULE_KINDS, type RuleConfig } from "./types";
import { SERVICES } from "./services";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const refresh = () => revalidatePath("/admin", "layout");
const NEED_LOGIN: ActionResult = { ok: false, message: "Сессия истекла: войдите снова" };
const DENIED: ActionResult = { ok: false, message: "Недостаточно прав для этого действия" };

/** Sends the lead and any waiting changes after the response, so the person is not kept waiting on the portal. */
function pushLater(leadId: string) {
  after(() => service.flushOutbox(leadId).catch((e) => console.error("outbox flush failed", leadId, e instanceof Error ? e.message : e)));
}

// ---- lead changes (any signed-in staff member; the command checks whose lead it is) -------------------------------------

export async function setStatusAction(id: string, status: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return NEED_LOGIN;
  const r = service.changeStatus(user, id, status);
  if (!r.ok) return { ok: false, message: r.error };
  pushLater(id);
  refresh();
  return { ok: true, message: "Статус обновлён" };
}

export async function assignAction(id: string, staffId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return NEED_LOGIN;
  const r = service.assignLead(user, id, staffId || null);
  if (!r.ok) return { ok: false, message: r.error };
  pushLater(id);
  refresh();
  return { ok: true, message: staffId ? "Ответственный назначен" : "Назначение снято" };
}

export async function addCommentAction(id: string, text: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return NEED_LOGIN;
  const r = service.addComment(user, id, text);
  if (!r.ok) return { ok: false, message: r.error };
  pushLater(id);
  refresh();
  return { ok: true, message: "Комментарий добавлен" };
}

export async function retrySyncAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return NEED_LOGIN;
  const lead = service.getLead(id);
  if (!lead) return { ok: false, message: "Заявка не найдена" };
  if (!canEditLead(user, lead)) return { ok: false, message: "Эта заявка закреплена за другим сотрудником" };

  const res = await service.retrySync(id);
  refresh();
  if (!res) return { ok: false, message: "Заявка уже отправлена или отправляется прямо сейчас" };
  return res.sync.status === "synced"
    ? { ok: true, message: res.sync.demo ? `Демо: лид создан в имитации, ID ${res.sync.bitrixId}` : `Битрикс24 подтвердил: лид ID ${res.sync.bitrixId}` }
    : { ok: false, message: res.sync.lastError ?? "Не удалось отправить заявку" };
}

export async function retryOutboxAction(itemId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return NEED_LOGIN;
  const r = await service.retryOutboxItem(user, itemId);
  refresh();
  return r.sent ? { ok: true, message: "Изменение отправлено в Битрикс24" } : { ok: false, message: r.reason };
}

// ---- manual lead -------------------------------------------------------------------------------------------------------

export interface ManualLeadState {
  errors?: Partial<Record<"name" | "phone" | "email" | "serviceId" | "comment" | "assigneeId", string>>;
  message?: string;
}

export async function createManualLeadAction(_: ManualLeadState, form: FormData): Promise<ManualLeadState> {
  const user = await getCurrentUser();
  if (!user) return { message: NEED_LOGIN.message };

  const parsed = manualLeadSchema.safeParse({
    name: form.get("name") ?? "",
    phone: form.get("phone") ?? "",
    email: form.get("email") ?? "",
    serviceId: form.get("serviceId") ?? "",
    comment: form.get("comment") ?? "",
    assigneeId: form.get("assigneeId") || undefined,
  });
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>;
    return { errors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0]])), message: "Проверьте заполнение формы" };
  }
  const key = String(form.get("idempotencyKey") ?? "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return { message: "Обновите страницу и повторите" };

  const r = service.createManualLead(user, parsed.data, key);
  if (!r.ok) return { message: r.error };

  const { lead, duplicate } = r.value;
  if (!duplicate && service.getSettings().autoSync) after(() => service.syncLeadNow(lead.id).catch((e) => console.error("lead sync crashed", lead.id, e instanceof Error ? e.message : e)));
  refresh();
  redirect(`/admin/leads/${lead.id}?flash=${duplicate ? "duplicate" : "created"}`);
}

// ---- administrators only: integration, automation, staff ----------------------------------------------------------------

async function adminOnly(check: (a: Actor) => boolean): Promise<Actor | ActionResult> {
  const user = await getCurrentUser();
  if (!user) return NEED_LOGIN;
  return check(user) ? user : DENIED;
}
const isResult = (v: Actor | ActionResult): v is ActionResult => "ok" in v;

/** The report holds portal host, user name and scopes, never the webhook URL. */
export async function testConnectionAction(): Promise<ConnectionReport | ActionResult> {
  const a = await adminOnly(canManageIntegration);
  if (isResult(a)) return a;
  return service.checkConnection();
}

const modeSchema = z.enum(["demo", "live"]);

/** Live mode needs a valid webhook in the environment; refusing here keeps the UI from claiming a connection it lacks. */
function modeError(mode: "demo" | "live") {
  if (mode === "live" && !getIntegrationStatus("live").webhookConfigured) {
    return "Боевой режим недоступен: задайте BITRIX24_WEBHOOK_URL в .env.local и перезапустите сервер.";
  }
  return null;
}

export async function setModeAction(value: string): Promise<ActionResult> {
  const a = await adminOnly(canManageIntegration);
  if (isResult(a)) return a;
  const parsed = modeSchema.safeParse(value);
  if (!parsed.success) return { ok: false, message: "Неизвестный режим" };
  const error = modeError(parsed.data);
  if (error) return { ok: false, message: error };
  service.saveSettings({ mode: parsed.data });
  refresh();
  return { ok: true, message: parsed.data === "live" ? "Включён боевой режим" : "Включён демонстрационный режим" };
}

const STATUS_ID = z.string().trim().regex(/^[A-Za-z0-9_:.-]{1,50}$/, "Только латиница, цифры и _ : . -");

const settingsSchema = z.object({
  mode: modeSchema,
  responsibleId: z.coerce.number("Укажите число").int("Укажите целое число").positive("ID должен быть больше нуля"),
  sourceId: z.string().trim().min(1, "Укажите код источника").max(30),
  notifyEmail: z.string().trim().refine((v) => v === "" || z.email().safeParse(v).success, "Проверьте адрес почты"),
  autoSync: z.boolean(),
  statusMap: z.object(Object.fromEntries(LEAD_STATUSES.map((s) => [s, STATUS_ID])) as Record<(typeof LEAD_STATUSES)[number], typeof STATUS_ID>),
});

export type SettingsErrors = Partial<Record<"mode" | "responsibleId" | "sourceId" | "notifyEmail" | "autoSync", string>> & Partial<Record<`status_${(typeof LEAD_STATUSES)[number]}`, string>>;
export type SettingsState = { errors?: SettingsErrors; result?: ActionResult };

export async function saveSettingsAction(_: SettingsState, form: FormData): Promise<SettingsState> {
  const a = await adminOnly(canManageIntegration);
  if (isResult(a)) return { result: a };

  const parsed = settingsSchema.safeParse({
    mode: form.get("mode") ?? service.getSettings().mode,
    responsibleId: form.get("responsibleId") ?? "",
    sourceId: form.get("sourceId") ?? "",
    notifyEmail: form.get("notifyEmail") ?? "",
    autoSync: form.get("autoSync") === "on",
    statusMap: Object.fromEntries(LEAD_STATUSES.map((s) => [s, form.get(`status_${s}`) ?? DEFAULT_STATUS_MAP[s]])),
  });
  if (!parsed.success) {
    const errors: SettingsErrors = {};
    for (const issue of parsed.error.issues) {
      const [head, sub] = issue.path;
      const key = head === "statusMap" ? `status_${String(sub)}` : String(head);
      (errors as Record<string, string>)[key] ??= issue.message;
    }
    return { errors, result: { ok: false, message: "Исправьте отмеченные поля" } };
  }
  const error = modeError(parsed.data.mode);
  if (error) return { errors: { mode: error }, result: { ok: false, message: "Исправьте отмеченные поля" } };
  service.saveSettings(parsed.data);
  refresh();
  return { result: { ok: true, message: "Настройки сохранены" } };
}

export async function toggleRuleAction(id: string, enabled: boolean): Promise<ActionResult> {
  const a = await adminOnly(canManageRules);
  if (isResult(a)) return a;
  if (!service.setRuleEnabled(id, enabled)) return { ok: false, message: "Правило не найдено" };
  refresh();
  return { ok: true, message: enabled ? "Правило включено" : "Правило выключено" };
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  const a = await adminOnly(canManageRules);
  if (isResult(a)) return a;
  if (!service.deleteRule(id)) return { ok: false, message: "Правило не найдено" };
  refresh();
  return { ok: true, message: "Правило удалено" };
}

export type RuleFormState = { error?: string; ok?: boolean };

export async function createRuleAction(_: RuleFormState, form: FormData): Promise<RuleFormState> {
  const a = await adminOnly(canManageRules);
  if (isResult(a)) return { error: a.message };

  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind") ?? "");
  if (name.length < 2 || name.length > 80) return { error: "Название: от 2 до 80 символов" };
  if (!(RULE_KINDS as readonly string[]).includes(kind)) return { error: "Выберите тип правила" };

  const known = new Set(wf.listStaff(getDb()).filter((s) => s.active).map((s) => s.id));
  let config: RuleConfig;
  if (kind === "by_service") {
    const assignments: Record<string, string> = {};
    for (const s of SERVICES) {
      const v = String(form.get(`service_${s.id}`) ?? "");
      if (v && known.has(v)) assignments[s.id] = v;
    }
    const fb = String(form.get("fallback") ?? "");
    if (Object.keys(assignments).length === 0 && !known.has(fb)) return { error: "Укажите хотя бы одного ответственного" };
    config = { kind: "by_service", assignments, fallbackStaffId: known.has(fb) ? fb : undefined };
  } else {
    const staffIds = form.getAll("staff").map(String).filter((id) => known.has(id));
    if (staffIds.length < 2) return { error: "Для распределения по кругу выберите минимум двух сотрудников" };
    config = { kind: "round_robin", staffIds };
  }
  service.createRule(name, config);
  refresh();
  return { ok: true };
}

export type StaffFormState = { error?: string; ok?: boolean };

const staffSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(80),
  email: z.email("Проверьте адрес почты").max(120),
  role: z.enum(["admin", "manager"]),
  password: z.string().min(10, "Пароль: минимум 10 символов").max(200),
  bitrixUserId: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().positive().optional()),
});

export async function createStaffAction(_: StaffFormState, form: FormData): Promise<StaffFormState> {
  const a = await adminOnly(canManageStaff);
  if (isResult(a)) return { error: a.message };
  const parsed = staffSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };

  const d = parsed.data;
  try {
    wf.insertStaff(getDb(), { id: `staff-${Math.random().toString(36).slice(2, 10)}`, name: d.name, email: d.email, role: d.role, active: true, bitrixUserId: d.bitrixUserId, passwordHash: hashPassword(d.password) });
  } catch {
    return { error: "Сотрудник с такой почтой уже есть" };
  }
  refresh();
  return { ok: true };
}

export async function setStaffActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const a = await adminOnly(canManageStaff);
  if (isResult(a)) return a;
  if (!active && id === a.id) return { ok: false, message: "Нельзя отключить самого себя" };
  if (!service.setStaffActive(id, active)) return { ok: false, message: "Сотрудник не найден" };
  refresh();
  return { ok: true, message: active ? "Сотрудник включён" : "Сотрудник отключён: войти он больше не сможет" };
}

export async function setStaffBitrixUserAction(id: string, value: string): Promise<ActionResult> {
  const a = await adminOnly(canManageStaff);
  if (isResult(a)) return a;
  const trimmed = value.trim();
  const n = trimmed === "" ? null : Number(trimmed);
  if (n !== null && (!Number.isInteger(n) || n <= 0)) return { ok: false, message: "ID должен быть положительным числом" };
  if (!service.setStaffBitrixUser(id, n)) return { ok: false, message: "Сотрудник не найден" };
  refresh();
  return { ok: true, message: "ID в Битрикс24 сохранён" };
}
