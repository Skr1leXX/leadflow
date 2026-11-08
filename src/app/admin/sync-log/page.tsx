import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import AdminLoading from "@/app/admin/loading";
import { AccessDenied } from "@/components/shared/access-denied";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DemoTag } from "@/components/shared/demo-tag";
import { nativeSelectClass } from "@/components/shared/field";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canManageIntegration } from "@/features/auth/permissions";
import { requireUser } from "@/features/auth/session";
import { eventTypeLabel, eventTypeName } from "@/features/leads/event-meta";
import { EVENT_TYPES, type EventQuery } from "@/features/leads/repo";
import { queryEvents } from "@/features/leads/service";
import type { SyncEvent } from "@/features/leads/types";
import { dateTime } from "@/lib/format";

export const metadata: Metadata = { title: "История синхронизации" };

type Params = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const columns: Column<SyncEvent>[] = [
  {
    header: "Время",
    cell: (e) => (
      <Link href={`/admin/sync-log/${e.id}`} className="font-medium whitespace-nowrap hover:text-primary">
        {dateTime(e.at)}
      </Link>
    ),
  },
  { header: "Операция", cell: (e) => eventTypeName(e.method) },
  {
    header: "Заявка",
    cell: (e) => (
      <Link href={`/admin/leads/${e.leadId}`} className="hover:text-primary">
        <span className="block font-medium">{e.leadName}</span>
        <code className="text-xs text-muted-foreground">{e.leadId}</code>
      </Link>
    ),
    className: "hidden md:table-cell",
  },
  { header: "ID в Битрикс24", cell: (e) => e.bitrixId ?? <span className="text-muted-foreground">—</span>, className: "hidden lg:table-cell" },
  {
    header: "Статус",
    cell: (e) => (
      <span className="inline-flex flex-wrap items-center gap-1">
        <StatusBadge tone={e.ok ? "success" : "danger"}>{e.ok ? "Успешно" : "Ошибка"}</StatusBadge>
        {e.demo && <DemoTag />}
      </span>
    ),
  },
  { header: "Попытка", cell: (e) => e.attempt, className: "hidden sm:table-cell" },
  {
    header: "Сообщение",
    cell: (e) => (
      <span className="line-clamp-2 text-muted-foreground">
        {e.message}
        {e.errorCode && <span className="block text-xs">Код: {e.errorCode}</span>}
      </span>
    ),
    className: "hidden xl:table-cell",
  },
];

export default function SyncLogPage({ searchParams }: { searchParams: Params }) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <SyncLogContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SyncLogContent({ searchParams }: { searchParams: Params }) {
  await connection();
  if (!canManageIntegration(await requireUser())) return <AccessDenied />;
  const sp = await searchParams;

  const query: EventQuery = {
    from: first(sp.from),
    to: first(sp.to),
    status: first(sp.status),
    type: first(sp.type),
    lead: first(sp.lead).trim().slice(0, 60),
    page: Number(first(sp.page)) || 1,
  };
  const { rows, total, page, pages } = queryEvents(query);
  const filtered = Boolean(query.from || query.to || query.status || query.type || query.lead);

  const href = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ from: query.from, to: query.to, status: query.status, type: query.type, lead: query.lead })) if (v) u.set(k, v);
    if (p > 1) u.set("page", String(p));
    return u.size ? `/admin/sync-log?${u}` : "/admin/sync-log";
  };

  return (
    <>
      <PageHeader title="История синхронизации" description="Каждое обращение к Битрикс24: что отправлено, чем закончилось и сколько было попыток. Пароли и токены в журнал не попадают." />

      <form className="mb-4 space-y-3 rounded-xl border bg-card p-3 sm:p-4" aria-label="Фильтры журнала">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-xs text-muted-foreground">
            С даты
            <Input type="date" name="from" defaultValue={query.from} className="h-10 text-foreground" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            По дату
            <Input type="date" name="to" defaultValue={query.to} className="h-10 text-foreground" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Статус
            <select name="status" defaultValue={query.status} className={`${nativeSelectClass} h-10 text-foreground`}>
              <option value="">Все</option>
              <option value="ok">Успешно</option>
              <option value="error">Ошибка</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Операция
            <select name="type" defaultValue={query.type} className={`${nativeSelectClass} h-10 text-foreground`}>
              <option value="">Все операции</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {eventTypeLabel[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            ID заявки
            <Input name="lead" defaultValue={query.lead} placeholder="lead-…" className="h-10 text-foreground" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-10">
            Применить
          </Button>
          {filtered && (
            <Button variant="ghost" className="h-10" nativeButton={false} render={<Link href="/admin/sync-log" />}>
              Сбросить
            </Button>
          )}
        </div>
      </form>

      <DataTable columns={columns} rows={rows} />
      <Pagination page={page} pages={pages} total={total} href={href} />
    </>
  );
}
