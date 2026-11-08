import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ModeSwitch } from "@/components/admin/mode-switch";
import { AccessDenied } from "@/components/shared/access-denied";
import { canManageIntegration } from "@/features/auth/permissions";
import { requireUser } from "@/features/auth/session";
import { TestConnection } from "@/components/admin/test-connection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { getIntegrationStatus, type IntegrationState } from "@/features/bitrix/integration";
import { FIELD_MAP, toBitrixLead } from "@/features/bitrix/mapper";
import { getSettings, listEvents, listLeads } from "@/features/leads/service";

export const metadata: Metadata = { title: "Интеграция с Битрикс24" };

type MapRow = (typeof FIELD_MAP)[number] & { id: string };
const columns: Column<MapRow>[] = [
  { header: "Поле LeadFlow", cell: (r) => r.from },
  { header: "Поле Битрикс24", cell: (r) => <code className="text-xs">{r.to}</code> },
  { header: "Правило", cell: (r) => <span className="text-muted-foreground">{r.note}</span>, className: "hidden sm:table-cell" },
];

const stateBadge: Record<IntegrationState, { label: string; tone: Tone }> = {
  demo: { label: "Демо-режим", tone: "warning" },
  ready: { label: "Боевой режим", tone: "success" },
  misconfigured: { label: "Не настроено", tone: "danger" },
};

const STEPS = [
  "В Битрикс24 откройте «Разработчикам» → «Другое» → «Входящий вебхук».",
  "Выдайте вебхуку право «CRM» и сохраните. Лучше создать отдельного пользователя-интегратора.",
  "Скопируйте адрес вебхука вида https://портал.bitrix24.ru/rest/1/код/ (без имени метода в конце).",
  "Запишите его в файл .env.local рядом с package.json: BITRIX24_WEBHOOK_URL=… и BITRIX24_MODE=live. Файл не попадает в Git.",
  "Перезапустите сервер, нажмите «Проверить соединение», затем включите боевой режим переключателем выше.",
];

export default async function IntegrationPage() {
  await connection();
  if (!canManageIntegration(await requireUser())) return <AccessDenied />;
  const settings = (await getSettings());
  const status = getIntegrationStatus(settings.mode);
  const leads = (await listLeads());
  const events = (await listEvents());
  const failed = leads.filter((l) => l.sync.status === "failed").length;
  const synced = leads.filter((l) => l.sync.status === "synced").length;
  const syncedDemo = leads.filter((l) => l.sync.status === "synced" && l.sync.demo).length;
  const queued = leads.filter((l) => l.sync.status === "pending" || l.sync.status === "sending").length;
  const lastOk = events.find((e) => e.ok);
  const sample = leads[0] ? toBitrixLead(leads[0], settings) : null;
  const badge = stateBadge[status.state];

  return (
    <>
      <PageHeader title="Интеграция с Битрикс24" description="Заявки уходят в CRM методом crm.lead.add через входящий вебхук" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex! flex-row items-center justify-between">
            <CardTitle>Подключение</CardTitle>
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
          </CardHeader>
          <CardContent className="space-y-5 text-sm">
            {status.state === "demo" && (
              <p className="rounded-lg bg-warning/15 p-3">
                Демонстрационный режим: вместо Битрикс24 работает встроенная имитация с тем же контрактом. Ни одна заявка не уходит на
                настоящий портал, а ID лидов в журнале условные.
              </p>
            )}
            {status.problem && (
              <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">
                {status.problem}
              </p>
            )}

            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Адрес портала</dt>
                <dd className="font-medium">{status.host ?? (status.state === "demo" ? "demo.bitrix24.ru (имитация)" : "не определён")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Вебхук в окружении</dt>
                <dd className="font-medium">{status.webhookConfigured ? "Задан (значение скрыто)" : "Не задан"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Автоматическая передача</dt>
                <dd className="font-medium">{settings.autoSync ? "Включена" : "Выключена"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Отправлено / с ошибкой / в очереди</dt>
                <dd className="font-medium">
                  {synced}
                  {syncedDemo > 0 && <span className="font-normal text-muted-foreground"> (из них демо: {syncedDemo})</span>} / {failed} / {queued}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Последняя успешная передача</dt>
                <dd className="font-medium">{lastOk ? lastOk.message : "Ещё не было"}</dd>
              </div>
            </dl>

            <div>
              <p className="mb-2 text-xs text-muted-foreground">Режим</p>
              <ModeSwitch mode={status.mode} webhookConfigured={status.webhookConfigured} />
            </div>

            <div className="flex flex-wrap items-start gap-3">
              <TestConnection />
              <Button variant="outline" className="h-10" nativeButton={false} render={<Link href="/admin/settings" />}>
                Параметры передачи
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Пример запроса</CardTitle>
          </CardHeader>
          <CardContent>
            {sample ? (
              <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs leading-relaxed" tabIndex={0}>
                {JSON.stringify({ fields: sample }, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">Появится после первой заявки.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Как подключить реальный портал</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm marker:text-muted-foreground">
            {STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">
            Адрес вебхука читается только на сервере и не передаётся в браузер. Для вызовов <code>/api/bitrix/*</code> в боевом
            режиме задайте ещё LEADFLOW_API_TOKEN и передавайте его как Bearer-токен.
          </p>
        </CardContent>
      </Card>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Сопоставление полей</h2>
      <DataTable columns={columns} rows={FIELD_MAP.map((r) => ({ ...r, id: r.to }))} />
    </>
  );
}
