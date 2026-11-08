import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import AdminLoading from "@/app/admin/loading";
import { AccessDenied } from "@/components/shared/access-denied";
import { DemoTag } from "@/components/shared/demo-tag";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageIntegration } from "@/features/auth/permissions";
import { requireUser } from "@/features/auth/session";
import { eventTypeName } from "@/features/leads/event-meta";
import { getEvent, getLead, listEventsForLead } from "@/features/leads/service";
import { dateTimeFull } from "@/lib/format";

export const metadata: Metadata = { title: "Запись журнала" };

type Params = Promise<{ id: string }>;

export default function SyncEventPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <SyncEventContent params={params} />
    </Suspense>
  );
}

async function SyncEventContent({ params }: { params: Params }) {
  await connection();
  if (!canManageIntegration(await requireUser())) return <AccessDenied />;
  const { id } = await params;
  const event = (await getEvent(id));
  if (!event) notFound();
  const lead = (await getLead(event.leadId));
  const related = (await listEventsForLead(event.leadId)).filter((e) => e.id !== event.id);

  const rows: [string, React.ReactNode][] = [
    ["Дата и время", dateTimeFull(event.at)],
    ["Операция", `${eventTypeName(event.method)} (${event.method})`],
    ["Заявка", lead ? <Link href={`/admin/leads/${lead.id}`} className="text-primary hover:underline">{lead.name} · <code>{lead.id}</code></Link> : <code>{event.leadId}</code>],
    ["ID в Битрикс24", event.bitrixId ?? "не получен"],
    ["Номер попытки", event.attempt],
    ["Время ответа", `${event.durationMs} мс`],
    ["Режим", event.demo ? "Демонстрационный: ответ имитирован, портал не опрашивался" : "Боевой: ответ настоящего портала"],
  ];

  return (
    <>
      <Link href="/admin/sync-log" className="mb-3 inline-flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Весь журнал
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{eventTypeName(event.method)}</h1>
        <StatusBadge tone={event.ok ? "success" : "danger"}>{event.ok ? "Успешно" : "Ошибка"}</StatusBadge>
        {event.demo && <DemoTag />}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Подробности</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium break-words">{v}</dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="text-xs text-muted-foreground">{event.ok ? "Ответ" : "Сообщение об ошибке"}</p>
              <p className={`mt-0.5 rounded-lg p-3 break-words ${event.ok ? "bg-muted" : "bg-destructive/10 text-destructive"}`}>{event.message}</p>
              {event.errorCode && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Код ошибки: <code>{event.errorCode}</code>
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Адреса вебхуков, токены и пароли перед записью в журнал маскируются и здесь не показываются.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Другие операции по заявке</CardTitle>
          </CardHeader>
          <CardContent>
            {related.length === 0 ? (
              <p className="text-sm text-muted-foreground">Других обращений к Битрикс24 по этой заявке не было.</p>
            ) : (
              <ul className="space-y-2">
                {related.map((e) => (
                  <li key={e.id}>
                    <Link href={`/admin/sync-log/${e.id}`} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm hover:bg-muted">
                      <span className="min-w-0">
                        <span className="block truncate">{eventTypeName(e.method)}</span>
                        <span className="block text-xs text-muted-foreground">
                          №{e.attempt} · {dateTimeFull(e.at)}
                        </span>
                      </span>
                      <StatusBadge tone={e.ok ? "success" : "danger"}>{e.ok ? "Успешно" : "Ошибка"}</StatusBadge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
