import { BitrixError, isRetryable, isSafeToResend, type BitrixClient } from "@/features/bitrix/client";
import { nextRetryAt } from "@/features/bitrix/sync";
import { newId } from "./commands";
import * as repo from "./repo";
import * as wf from "./repo-workflow";
import type { Db } from "./sql";
import { STALE_LOCK_MS } from "./sync-runner";
import type { IntegrationSettings, LeadStatus, OutboxItem } from "./types";

export interface OutboxDeps {
  db: Db;
  client: BitrixClient;
  settings: IntegrationSettings;
  now?: () => Date;
}

export type SendResult = { sent: true } | { sent: false; reason: string };

const METHOD: Record<OutboxItem["kind"], string> = {
  status: "crm.lead.update",
  assignee: "crm.lead.update",
  comment: "crm.timeline.comment.add",
};

/**
 * Pushes one queued change to Bitrix24. It waits (without failing) until the lead exists there, and it never sends a
 * change recorded against a demo lead ID to a real portal, or the other way round.
 */
export async function sendOutboxItem({ db, client, settings, now = () => new Date() }: OutboxDeps, id: string): Promise<SendResult> {
  const item = await wf.getOutbox(db, id);
  if (!item) return { sent: false, reason: "Запись не найдена" };
  if (item.status === "done") return { sent: false, reason: "Уже отправлено" };
  const lead = await repo.getLead(db, item.leadId);
  if (!lead?.sync.bitrixId || lead.sync.status !== "synced") return { sent: false, reason: "Заявка ещё не создана в Битрикс24: изменение уйдёт после её отправки" };
  if (lead.sync.demo !== client.demo) {
    return { sent: false, reason: lead.sync.demo ? "Заявка отправлена только в демо-режиме: сначала отправьте её в боевой Битрикс24" : "Заявка создана в боевом Битрикс24, а сейчас включён демо-режим" };
  }

  const t = now();
  if (!(await wf.claimOutbox(db, id, t.toISOString(), new Date(t.getTime() - STALE_LOCK_MS).toISOString()))) return { sent: false, reason: "Изменение уже отправляется" };

  const started = Date.now();
  const attempts = item.attempts + 1;
  const prefix = client.demo ? "Демо: " : "";
  const bitrixId = lead.sync.bitrixId;
  try {
    if (item.kind === "status") {
      await client.updateLead(bitrixId, { STATUS_ID: settings.statusMap[item.payload as LeadStatus] });
    } else if (item.kind === "assignee") {
      const person = await wf.getStaff(db, item.payload);
      if (!person?.bitrixUserId) throw new BitrixError(`У сотрудника${person ? ` ${person.name}` : ""} не указан ID пользователя в Битрикс24 (раздел «Сотрудники»)`, "NO_BITRIX_USER");
      await client.updateLead(bitrixId, { ASSIGNED_BY_ID: person.bitrixUserId });
    } else {
      await client.addLeadComment(bitrixId, item.payload);
    }
    const at = now().toISOString();
    // The state change and its journal entry are saved together or not at all.
    await db.tx(async (t) => {
      await wf.finishOutbox(t, id, { status: "done", attempts, doneAt: at, demo: client.demo });
      await repo.insertEvent(t, { id: newId("ev"), leadId: lead.id, leadName: lead.name, at, method: METHOD[item.kind], attempt: attempts, ok: true, bitrixId, message: `${prefix}${describe(item)}: подтверждено`, durationMs: Date.now() - started, demo: client.demo });
    });
    return { sent: true };
  } catch (e) {
    const code = e instanceof BitrixError ? e.code : "UNKNOWN";
    const message = e instanceof BitrixError ? e.message : "Неизвестная ошибка обмена";
    const at = now();
    const retry = (item.kind === "comment" ? isSafeToResend(code) : isRetryable(code)) ? nextRetryAt(attempts, at) : undefined;
    await db.tx(async (t) => {
      await wf.finishOutbox(t, id, { status: "failed", attempts, error: prefix + message, code, nextRetryAt: retry, demo: client.demo });
      await repo.insertEvent(t, { id: newId("ev"), leadId: lead.id, leadName: lead.name, at: at.toISOString(), method: METHOD[item.kind], attempt: attempts, ok: false, bitrixId, errorCode: code, message: `${prefix}${describe(item)}: ${message}`, durationMs: Date.now() - started, demo: client.demo });
    });
    return { sent: false, reason: prefix + message };
  }
}

const describe = (i: OutboxItem) => ({ status: "смена статуса", assignee: "смена ответственного", comment: "комментарий" })[i.kind];

/** Sends everything that is due, optionally for one lead. Returns how many items Bitrix24 confirmed. */
export async function processOutbox(deps: OutboxDeps, opts: { leadId?: string; limit?: number } = {}): Promise<number> {
  const t = (deps.now ?? (() => new Date()))();
  const ids = await wf.listDueOutbox(deps.db, t.toISOString(), new Date(t.getTime() - STALE_LOCK_MS).toISOString(), opts.limit ?? 20, opts.leadId);
  let sent = 0;
  for (const id of ids) if ((await sendOutboxItem(deps, id)).sent) sent++;
  return sent;
}
