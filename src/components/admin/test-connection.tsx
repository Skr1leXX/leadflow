"use client";

import { useState, useTransition } from "react";
import { CircleAlert, CircleCheck, Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { testConnectionAction, type ActionResult } from "@/features/leads/actions";
import type { ConnectionReport } from "@/features/bitrix/integration";

export function TestConnection() {
  const [pending, start] = useTransition();
  const [report, setReport] = useState<ConnectionReport | ActionResult | null>(null);

  return (
    <div className="space-y-3">
      <Button className="h-10" disabled={pending} onClick={() => start(async () => setReport(await testConnectionAction()))}>
        {pending ? <Loader2 className="animate-spin" /> : <PlugZap />} Проверить соединение
      </Button>
      <div role="status" aria-live="polite">
        {report && "info" in report && report.ok && (
          <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-success">
              <CircleCheck className="size-4" /> {report.info.demo ? "Демо-ответ получен" : "Соединение работает"}
            </p>
            {report.info.demo && (
              <p className="mt-1 text-muted-foreground">Это имитация: реальный портал не опрашивался и заявки в него не уходят.</p>
            )}
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Портал</dt>
              <dd>{report.info.portal}</dd>
              {report.info.user && (
                <>
                  <dt className="text-muted-foreground">Пользователь</dt>
                  <dd>{report.info.user}</dd>
                </>
              )}
              {report.info.scopes && (
                <>
                  <dt className="text-muted-foreground">Права</dt>
                  <dd>{report.info.scopes.join(", ") || "не указаны"}</dd>
                </>
              )}
              {report.info.serverTime && (
                <>
                  <dt className="text-muted-foreground">Время портала</dt>
                  <dd>{report.info.serverTime}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Отклик</dt>
              <dd>{report.info.latencyMs} мс</dd>
            </dl>
          </div>
        )}
        {report && "message" in report && !report.ok && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {report.message}
          </p>
        )}
        {report && "error" in report && !report.ok && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <CircleAlert className="size-4" /> Не удалось подключиться
            </p>
            <p className="mt-1">{report.error.message}</p>
            <p className="mt-1 text-xs text-muted-foreground">Код: {report.error.code}</p>
          </div>
        )}
      </div>
    </div>
  );
}
