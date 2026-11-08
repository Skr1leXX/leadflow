"use client";

import { useTransition } from "react";
import { RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DemoTag } from "@/components/shared/demo-tag";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { useToast } from "@/components/shared/toaster";
import type { IntegrationMode } from "@/features/bitrix/client";
import { retryOutboxAction, retrySyncAction } from "@/features/leads/actions";
import { syncStatusMeta } from "@/features/leads/status-meta";
import type { Lead, OutboxItem, OutboxStatus, SyncEvent } from "@/features/leads/types";
import { dateTime } from "@/lib/format";

const OUTBOX_STATUS: Record<OutboxStatus, { label: string; tone: Tone }> = {
  pending: { label: "Ожидает", tone: "warning" },
  sending: { label: "Отправляется", tone: "info" },
  done: { label: "Отправлено", tone: "success" },
  failed: { label: "Ошибка", tone: "danger" },
};
const OUTBOX_KIND = { status: "Смена статуса", assignee: "Смена ответственного", comment: "Комментарий" } as const;

function retryLabel(lead: Lead, mode: IntegrationMode) {
  if (lead.sync.status === "pending") return "Отправить в Битрикс24";
  if (lead.sync.status === "synced") return "Отправить в боевой Битрикс24";
  return mode === "demo" ? "Повторить отправку (демо)" : "Повторить отправку";
}

export function SyncPanel({ lead, events, outbox, canEdit, mode }: { lead: Lead; events: SyncEvent[]; outbox: OutboxItem[]; canEdit: boolean; mode: IntegrationMode }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const { sync } = lead;

  // A synced lead may be sent again only when its outcome was simulated and live mode is now on.
  const canRetry = canEdit && sync.status !== "sending" && (sync.status !== "synced" || (sync.demo && mode === "live"));
  const autoNote = sync.status === "failed" && (sync.nextRetryAt ? `Следующая автоматическая попытка: ${dateTime(sync.nextRetryAt)}` : "Автоматических попыток больше не будет: отправьте заявку вручную.");

  return (
    <div className="space-y-5 text-sm">
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Заявка в Битрикс24</p>
          <span className="inline-flex items-center gap-1">
            <StatusBadge tone={syncStatusMeta[sync.status].tone}>{syncStatusMeta[sync.status].label}</StatusBadge>
            {sync.demo && <DemoTag />}
          </span>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{sync.demo ? "Демо-ID лида" : "ID лида"}</dt>
          <dd>{sync.bitrixId ?? "ещё не создан"}</dd>
          <dt className="text-muted-foreground">Попыток</dt>
          <dd>{sync.attempts}</dd>
          {sync.lastAttemptAt && (
            <>
              <dt className="text-muted-foreground">Последняя</dt>
              <dd>{dateTime(sync.lastAttemptAt)}</dd>
            </>
          )}
        </dl>
        {sync.demo && sync.status === "synced" && <p className="mt-2 text-xs text-muted-foreground">Это результат имитации: в настоящий Битрикс24 заявка не отправлялась.</p>}
        {sync.status === "failed" && sync.lastError && (
          <div role="alert" className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <p>{sync.lastError}</p>
            {sync.lastErrorCode && <p className="mt-0.5 opacity-80">Код: {sync.lastErrorCode}</p>}
          </div>
        )}
        {autoNote && <p className="mt-2 text-xs text-muted-foreground">{autoNote}</p>}
        {sync.status === "sending" && <p className="mt-2 text-xs text-muted-foreground">Идёт отправка. Обновите страницу через несколько секунд.</p>}
        {canRetry && (
          <Button variant="outline" className="mt-3 h-10 w-full" disabled={pending} onClick={() => start(async () => toast.result(await retrySyncAction(lead.id)))}>
            {pending ? <RefreshCw className="animate-spin" /> : sync.status === "failed" ? <RefreshCw /> : <Send />} {retryLabel(lead, mode)}
          </Button>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Изменения для Битрикс24</p>
        {outbox.length === 0 ? (
          <p className="text-xs text-muted-foreground">Изменений пока не было.</p>
        ) : (
          <ul className="space-y-2">
            {outbox.map((o) => (
              <li key={o.id} className="rounded-md border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{OUTBOX_KIND[o.kind]}</span>
                  <span className="inline-flex items-center gap-1">
                    <StatusBadge tone={OUTBOX_STATUS[o.status].tone}>{OUTBOX_STATUS[o.status].label}</StatusBadge>
                    {o.demo && <DemoTag />}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {dateTime(o.createdAt)}
                  {o.attempts > 0 && ` · попыток: ${o.attempts}`}
                </p>
                {o.status === "pending" && sync.status !== "synced" && <p className="mt-1 text-muted-foreground">Уйдёт после создания лида в Битрикс24.</p>}
                {o.status === "failed" && o.lastError && (
                  <p className="mt-1 text-destructive">
                    {o.lastError}
                    {o.lastErrorCode && <span className="block opacity-80">Код: {o.lastErrorCode}</span>}
                    {o.nextRetryAt && <span className="block text-muted-foreground">Следующая попытка: {dateTime(o.nextRetryAt)}</span>}
                  </p>
                )}
                {o.status !== "done" && canEdit && (o.status === "failed" || sync.status === "synced") && (
                  <Button variant="outline" className="mt-2 h-9" disabled={pending} onClick={() => start(async () => toast.result(await retryOutboxAction(o.id)))}>
                    <RefreshCw className={pending ? "animate-spin" : undefined} /> Отправить сейчас
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Журнал обмена</p>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">Попыток ещё не было.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="rounded-md border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    №{e.attempt} · {dateTime(e.at)} · {e.durationMs} мс
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <StatusBadge tone={e.ok ? "success" : "danger"}>{e.ok ? "Успешно" : "Ошибка"}</StatusBadge>
                    {e.demo && <DemoTag />}
                  </span>
                </div>
                <p className="mt-1 break-words">{e.message}</p>
                <p className="text-muted-foreground">
                  <code>{e.method}</code>
                  {e.errorCode && ` · код ${e.errorCode}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
