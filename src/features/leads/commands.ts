import { randomBytes } from "node:crypto";
import { canAssign, canEditLead, type Actor } from "@/features/auth/permissions";
import type { ManualLeadData } from "./schema";
import * as repo from "./repo";
import * as wf from "./repo-workflow";
import type { Db } from "./sql";
import { leadStatusMeta } from "./status-meta";
import { LEAD_STATUSES, type Lead, type LeadStatus } from "./types";

export type Failure = { ok: false; code: "forbidden" | "not_found" | "invalid"; error: string };
export type Result<T> = { ok: true; value: T } | Failure;

const fail = (code: Failure["code"], error: string): Failure => ({ ok: false, code, error });
export const newId = (prefix: string) => `${prefix}-${randomBytes(5).toString("hex")}`;

const FORBIDDEN = "Эта заявка закреплена за другим сотрудником: менять её может только он или администратор.";

async function load(db: Db, actor: Actor, leadId: string): Promise<Result<Lead>> {
  const lead = await repo.getLead(db, leadId);
  if (!lead) return fail("not_found", "Заявка не найдена");
  return canEditLead(actor, lead) ? { ok: true, value: lead } : fail("forbidden", FORBIDDEN);
}

/** Changes the status, records it in the history and queues the change for Bitrix24, all in one transaction. */
export async function changeStatus(db: Db, actor: Actor, leadId: string, status: string, now = new Date()): Promise<Result<Lead>> {
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) return fail("invalid", "Неизвестный статус");
  const next = status as LeadStatus;
  const loaded = await load(db, actor, leadId);
  if (!loaded.ok) return loaded;
  const lead = loaded.value;
  if (lead.status === next) return { ok: true, value: lead };

  await db.tx(async (t) => {
    if (!(await repo.setStatus(t, leadId, next))) throw new Error("status not saved");
    await wf.insertTimeline(t, { id: newId("tl"), leadId, kind: "status", actorId: actor.id, actorName: actor.name, at: now.toISOString(), from: leadStatusMeta[lead.status].label, to: leadStatusMeta[next].label });
    await wf.enqueueOutbox(t, { id: newId("ob"), leadId, kind: "status", payload: next, createdAt: now.toISOString() });
  });
  return { ok: true, value: { ...lead, status: next } };
}

/** Assigns (or clears) the responsible person. Only active staff can be assigned. */
export async function assignLead(db: Db, actor: Actor, leadId: string, staffId: string | null, now = new Date()): Promise<Result<Lead>> {
  const loaded = await load(db, actor, leadId);
  if (!loaded.ok) return loaded;
  const lead = loaded.value;
  if (!canAssign(actor, lead)) return fail("forbidden", FORBIDDEN);
  if ((lead.assigneeId ?? null) === staffId) return { ok: true, value: lead };

  const target = staffId ? await wf.getStaff(db, staffId) : undefined;
  if (staffId && (!target || !target.active)) return fail("invalid", "Этот сотрудник недоступен для назначения");
  const before = lead.assigneeId ? (await wf.getStaff(db, lead.assigneeId))?.name : undefined;

  await db.tx(async (t) => {
    if (!(await repo.assignLead(t, leadId, staffId))) throw new Error("assignee not saved");
    await wf.insertTimeline(t, { id: newId("tl"), leadId, kind: "assignee", actorId: actor.id, actorName: actor.name, at: now.toISOString(), from: before ?? "не назначен", to: target?.name ?? "не назначен" });
    // Bitrix24 has no "unassigned" state, so only a real person is pushed.
    if (staffId) await wf.enqueueOutbox(t, { id: newId("ob"), leadId, kind: "assignee", payload: staffId, createdAt: now.toISOString() });
  });
  return { ok: true, value: { ...lead, assigneeId: staffId ?? undefined } };
}

export async function addComment(db: Db, actor: Actor, leadId: string, text: string, now = new Date()): Promise<Result<{ id: string }>> {
  const body = text.trim();
  if (!body) return fail("invalid", "Введите текст комментария");
  if (body.length > 2000) return fail("invalid", "Комментарий длиннее 2000 символов");
  const loaded = await load(db, actor, leadId);
  if (!loaded.ok) return loaded;

  const id = newId("tl");
  await db.tx(async (t) => {
    await wf.insertTimeline(t, { id, leadId, kind: "comment", actorId: actor.id, actorName: actor.name, at: now.toISOString(), body });
    await wf.enqueueOutbox(t, { id: newId("ob"), leadId, kind: "comment", payload: `${actor.name}: ${body}`, createdAt: now.toISOString() });
  });
  return { ok: true, value: { id } };
}

/** Creates a lead typed in by staff. The key makes a double submit of the same form return the same lead. */
export async function createManualLead(db: Db, actor: Actor, data: ManualLeadData, idempotencyKey: string, now = new Date()): Promise<Result<{ lead: Lead; duplicate: boolean }>> {
  const existing = await repo.findByIdempotencyKey(db, idempotencyKey);
  if (existing) return { ok: true, value: { lead: existing, duplicate: true } };

  let assigneeId: string | undefined;
  if (data.assigneeId) {
    const target = await wf.getStaff(db, data.assigneeId);
    if (!target || !target.active) return fail("invalid", "Этот сотрудник недоступен для назначения");
    // A manager may only create leads for themselves; handing one to a colleague is an admin's call.
    if (actor.role !== "admin" && target.id !== actor.id) return fail("forbidden", "Менеджер может создать заявку только на себя");
    assigneeId = target.id;
  }

  const lead: Lead = {
    id: newId("lead"),
    name: data.name,
    phone: data.phone,
    email: data.email,
    serviceId: data.serviceId,
    comment: data.comment,
    status: "new",
    assigneeId,
    createdAt: now.toISOString(),
    source: "manual",
    demoData: false,
    sync: { status: "pending", attempts: 0, demo: false },
  };
  try {
    await db.tx(async (t) => {
      await repo.insertLead(t, lead, { idempotencyKey });
      await wf.insertTimeline(t, { id: newId("tl"), leadId: lead.id, kind: "created", actorId: actor.id, actorName: actor.name, at: now.toISOString(), body: "Заявка создана вручную" });
    });
  } catch (e) {
    const winner = await repo.findByIdempotencyKey(db, idempotencyKey);
    if (winner) return { ok: true, value: { lead: winner, duplicate: true } };
    throw e;
  }
  return { ok: true, value: { lead, duplicate: false } };
}
