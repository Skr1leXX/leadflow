import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canAssign, canEditLead, type Actor } from "@/features/auth/permissions";
import type { ManualLeadData } from "./schema";
import * as repo from "./repo";
import * as wf from "./repo-workflow";
import { leadStatusMeta } from "./status-meta";
import { LEAD_STATUSES, type Lead, type LeadStatus } from "./types";

export type Failure = { ok: false; code: "forbidden" | "not_found" | "invalid"; error: string };
export type Result<T> = { ok: true; value: T } | Failure;

const fail = (code: Failure["code"], error: string): Failure => ({ ok: false, code, error });
export const newId = (prefix: string) => `${prefix}-${randomBytes(5).toString("hex")}`;

/** Runs `fn` as one transaction. `fn` must be synchronous: an await inside would let other work interleave on the shared connection. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const FORBIDDEN = "Эта заявка закреплена за другим сотрудником: менять её может только он или администратор.";

function load(db: DatabaseSync, actor: Actor, leadId: string): Result<Lead> {
  const lead = repo.getLead(db, leadId);
  if (!lead) return fail("not_found", "Заявка не найдена");
  return canEditLead(actor, lead) ? { ok: true, value: lead } : fail("forbidden", FORBIDDEN);
}

/** Changes the status, records it in the history and queues the change for Bitrix24, all in one transaction. */
export function changeStatus(db: DatabaseSync, actor: Actor, leadId: string, status: string, now = new Date()): Result<Lead> {
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) return fail("invalid", "Неизвестный статус");
  const next = status as LeadStatus;
  const loaded = load(db, actor, leadId);
  if (!loaded.ok) return loaded;
  const lead = loaded.value;
  if (lead.status === next) return { ok: true, value: lead };

  tx(db, () => {
    if (!repo.setStatus(db, leadId, next)) throw new Error("status not saved");
    wf.insertTimeline(db, { id: newId("tl"), leadId, kind: "status", actorId: actor.id, actorName: actor.name, at: now.toISOString(), from: leadStatusMeta[lead.status].label, to: leadStatusMeta[next].label });
    wf.enqueueOutbox(db, { id: newId("ob"), leadId, kind: "status", payload: next, createdAt: now.toISOString() });
  });
  return { ok: true, value: { ...lead, status: next } };
}

/** Assigns (or clears) the responsible person. Only active staff can be assigned. */
export function assignLead(db: DatabaseSync, actor: Actor, leadId: string, staffId: string | null, now = new Date()): Result<Lead> {
  const loaded = load(db, actor, leadId);
  if (!loaded.ok) return loaded;
  const lead = loaded.value;
  if (!canAssign(actor, lead)) return fail("forbidden", FORBIDDEN);
  if ((lead.assigneeId ?? null) === staffId) return { ok: true, value: lead };

  const target = staffId ? wf.getStaff(db, staffId) : undefined;
  if (staffId && (!target || !target.active)) return fail("invalid", "Этот сотрудник недоступен для назначения");
  const before = lead.assigneeId ? wf.getStaff(db, lead.assigneeId)?.name : undefined;

  tx(db, () => {
    if (!repo.assignLead(db, leadId, staffId)) throw new Error("assignee not saved");
    wf.insertTimeline(db, { id: newId("tl"), leadId, kind: "assignee", actorId: actor.id, actorName: actor.name, at: now.toISOString(), from: before ?? "не назначен", to: target?.name ?? "не назначен" });
    // Bitrix24 has no "unassigned" state, so only a real person is pushed.
    if (staffId) wf.enqueueOutbox(db, { id: newId("ob"), leadId, kind: "assignee", payload: staffId, createdAt: now.toISOString() });
  });
  return { ok: true, value: { ...lead, assigneeId: staffId ?? undefined } };
}

export function addComment(db: DatabaseSync, actor: Actor, leadId: string, text: string, now = new Date()): Result<{ id: string }> {
  const body = text.trim();
  if (!body) return fail("invalid", "Введите текст комментария");
  if (body.length > 2000) return fail("invalid", "Комментарий длиннее 2000 символов");
  const loaded = load(db, actor, leadId);
  if (!loaded.ok) return loaded;

  const id = newId("tl");
  tx(db, () => {
    wf.insertTimeline(db, { id, leadId, kind: "comment", actorId: actor.id, actorName: actor.name, at: now.toISOString(), body });
    wf.enqueueOutbox(db, { id: newId("ob"), leadId, kind: "comment", payload: `${actor.name}: ${body}`, createdAt: now.toISOString() });
  });
  return { ok: true, value: { id } };
}

/** Creates a lead typed in by staff. The key makes a double submit of the same form return the same lead. */
export function createManualLead(db: DatabaseSync, actor: Actor, data: ManualLeadData, idempotencyKey: string, now = new Date()): Result<{ lead: Lead; duplicate: boolean }> {
  const existing = repo.findByIdempotencyKey(db, idempotencyKey);
  if (existing) return { ok: true, value: { lead: existing, duplicate: true } };

  let assigneeId: string | undefined;
  if (data.assigneeId) {
    const target = wf.getStaff(db, data.assigneeId);
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
    tx(db, () => {
      repo.insertLead(db, lead, { idempotencyKey });
      wf.insertTimeline(db, { id: newId("tl"), leadId: lead.id, kind: "created", actorId: actor.id, actorName: actor.name, at: now.toISOString(), body: "Заявка создана вручную" });
    });
  } catch (e) {
    const winner = repo.findByIdempotencyKey(db, idempotencyKey);
    if (winner) return { ok: true, value: { lead: winner, duplicate: true } };
    throw e;
  }
  return { ok: true, value: { lead, duplicate: false } };
}
