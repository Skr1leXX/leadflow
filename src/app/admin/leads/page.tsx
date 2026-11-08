import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { ChevronDown, Plus, Search } from "lucide-react";
import AdminLoading from "@/app/admin/loading";
import { LeadsTable } from "@/components/admin/leads-table";
import { nativeSelectClass } from "@/components/shared/field";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/features/auth/session";
import { LEAD_SORTS, type LeadQuery, type LeadSort } from "@/features/leads/repo";
import { listStaff, queryLeads } from "@/features/leads/service";
import { leadStatusMeta } from "@/features/leads/status-meta";
import { LEAD_STATUSES } from "@/features/leads/types";

export const metadata: Metadata = { title: "Заявки" };

type Params = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const SORT_LABEL: Record<LeadSort, string> = { created: "По дате создания", name: "По имени", status: "По статусу" };

export default function LeadsPage({ searchParams }: { searchParams: Params }) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <LeadsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LeadsContent({ searchParams }: { searchParams: Params }) {
  await connection();
  await requireUser();
  const sp = await searchParams;

  const sort = (LEAD_SORTS as readonly string[]).includes(first(sp.sort)) ? (first(sp.sort) as LeadSort) : "created";
  const query: LeadQuery = {
    q: first(sp.q).trim().slice(0, 100),
    status: first(sp.status),
    source: first(sp.source),
    assignee: first(sp.assignee),
    from: first(sp.from),
    to: first(sp.to),
    sort,
    dir: first(sp.dir) === "asc" ? "asc" : "desc",
    page: Number(first(sp.page)) || 1,
  };
  const { rows, total, page, pages } = queryLeads(query);
  const staff = listStaff();

  // Everything except the page number, so pagination keeps the filters.
  const href = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: query.q, status: query.status, source: query.source, assignee: query.assignee, from: query.from, to: query.to })) if (v) u.set(k, v);
    if (sort !== "created") u.set("sort", sort);
    if (query.dir === "asc") u.set("dir", "asc");
    if (p > 1) u.set("page", String(p));
    return u.size ? `/admin/leads?${u}` : "/admin/leads";
  };
  const filtered = Boolean(query.q || query.status || query.source || query.assignee || query.from || query.to);

  return (
    <>
      <PageHeader
        title="Заявки"
        description="Обращения с сайта и созданные вручную, их статус, ответственные и передача в Битрикс24"
        actions={
          <Button className="h-10" nativeButton={false} render={<Link href="/admin/leads/new" />}>
            <Plus /> Новая заявка
          </Button>
        }
      />

      <form className="mb-4 space-y-3 rounded-xl border bg-card p-3 sm:p-4" aria-label="Фильтры заявок">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={query.q} aria-label="Поиск по имени, телефону и email" placeholder="Поиск по имени, телефону или email" className="h-10 pl-9" />
        </div>
        {/* Below lg the filters sit behind this checkbox toggle (pure CSS, works without JS); they start open when a filter is active. */}
        <input type="checkbox" id="filters-toggle" defaultChecked={filtered} className="peer sr-only" />
        <label
          htmlFor="filters-toggle"
          className="flex min-h-10 cursor-pointer items-center justify-between rounded-lg border px-3 text-sm peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 lg:hidden"
        >
          Фильтры и сортировка
          <ChevronDown className="size-4" />
        </label>
        <div className="hidden gap-3 peer-checked:grid sm:grid-cols-2 lg:grid lg:grid-cols-4">
          <label className="space-y-1 text-xs text-muted-foreground">
            Статус
            <select name="status" defaultValue={query.status} className={`${nativeSelectClass} h-10 text-foreground`}>
              <option value="">Все статусы</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {leadStatusMeta[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Источник
            <select name="source" defaultValue={query.source} className={`${nativeSelectClass} h-10 text-foreground`}>
              <option value="">Все источники</option>
              <option value="website">Сайт</option>
              <option value="manual">Вручную</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Ответственный
            <select name="assignee" defaultValue={query.assignee} className={`${nativeSelectClass} h-10 text-foreground`}>
              <option value="">Все</option>
              <option value="none">Не назначен</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " (отключён)"}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Сортировка
            <select name="sort" defaultValue={sort} className={`${nativeSelectClass} h-10 text-foreground`}>
              {LEAD_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Порядок
            <select name="dir" defaultValue={query.dir} className={`${nativeSelectClass} h-10 text-foreground`}>
              <option value="desc">Сначала новые / Я→А</option>
              <option value="asc">Сначала старые / А→Я</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Создана с
            <Input type="date" name="from" defaultValue={query.from} className="h-10 text-foreground" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Создана по
            <Input type="date" name="to" defaultValue={query.to} className="h-10 text-foreground" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-10">
            Применить
          </Button>
          {filtered && (
            <Button variant="ghost" className="h-10" nativeButton={false} render={<Link href="/admin/leads" />}>
              Сбросить
            </Button>
          )}
        </div>
      </form>

      <LeadsTable leads={rows} staff={staff} />
      <Pagination page={page} pages={pages} total={total} href={href} />
    </>
  );
}
