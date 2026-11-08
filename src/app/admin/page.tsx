import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Info } from "lucide-react";
import AdminLoading from "@/app/admin/loading";
import { PeriodPicker } from "@/components/admin/period-picker";
import { BarList } from "@/components/shared/bar-list";
import { EmptyState } from "@/components/shared/empty-state";
import { LeadsChart } from "@/components/shared/leads-chart";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/features/auth/session";
import { dashboard, queryLeads } from "@/features/leads/service";
import { serviceTitle } from "@/features/leads/services";
import { leadStatusMeta, syncStatusMeta } from "@/features/leads/status-meta";
import { LEAD_STATUSES } from "@/features/leads/types";
import { dateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

type Params = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const TONE_BAR: Record<Tone, string> = { info: "bg-primary", warning: "bg-warning", success: "bg-success", danger: "bg-destructive", neutral: "bg-muted-foreground/60" };
const SOURCE_LABEL: Record<string, string> = { website: "Форма на сайте", manual: "Вручную" };
const PERIOD_LABEL = { week: "последние 7 дней", month: "последние 30 дней", quarter: "последние 90 дней", custom: "выбранный период" } as const;

const pct = (n: number) => `${n.toString().replace(".", ",")}%`;
const ruDate = (day: string) => day.split("-").reverse().join(".");

export default function DashboardPage({ searchParams }: { searchParams: Params }) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardContent({ searchParams }: { searchParams: Params }) {
  await connection(); // reads per-request data and the current time
  await requireUser();
  const sp = await searchParams;
  const hideDemo = first(sp.demo) === "hide";

  const d = dashboard({ period: first(sp.period), from: first(sp.from), to: first(sp.to), includeDemo: !hideDemo }, new Date());
  const recent = queryLeads({ pageSize: 6 }).rows;
  const keep = (extra: string) => `/admin?period=${d.period}${d.period === "custom" ? `&from=${d.range.from}&to=${d.range.to}` : ""}${extra}`;
  const rangeText = `${ruDate(d.range.from)} — ${ruDate(d.range.to)}`;

  return (
    <>
      <PageHeader title="Dashboard" description={`Заявки за ${PERIOD_LABEL[d.period]}: ${rangeText}`} />
      <PeriodPicker period={d.period} from={d.range.from} to={d.range.to} hideDemo={hideDemo} />

      {d.note && (
        <p role="alert" className="mb-4 rounded-lg bg-warning/15 p-3 text-sm">
          {d.note}
        </p>
      )}
      {d.demoInPeriod > 0 && (
        <p role="note" data-testid="demo-notice" className="mb-4 flex flex-wrap items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {hideDemo
              ? `Демонстрационные данные скрыты: ${d.demoInPeriod} вымышленных заявок за период не учтены.`
              : `В расчёт входят ${d.demoInPeriod} демонстрационных заявок: это вымышленные записи, созданные при первом запуске.`}
          </span>
          <Link href={keep(hideDemo ? "" : "&demo=hide")} className="inline-flex min-h-9 items-center font-medium underline underline-offset-2">
            {hideDemo ? "Показать демо-данные" : "Скрыть демо-данные"}
          </Link>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="kpis">
        <StatCard label="Всего заявок" value={String(d.total)} delta={d.delta} hint={d.previousTotal ? `к предыдущему периоду (${d.previousTotal})` : "предыдущий период пуст"} />
        <StatCard label="Новые" value={String(d.byStatus.new)} hint="ждут реакции менеджера" />
        <StatCard label="В работе" value={String(d.byStatus.in_progress)} hint="менеджер занимается заявкой" />
        <StatCard label="Успешно завершены" value={String(d.byStatus.won)} hint="доведены до результата" />
        <StatCard label="Отклонены" value={String(d.byStatus.rejected)} hint="закрыты без результата" />
        <StatCard label="Конверсия" value={pct(d.conversion)} hint="доля успешно завершённых" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Поступление заявок по дням</CardTitle>
            <p className="text-sm text-muted-foreground">{rangeText}</p>
          </CardHeader>
          <CardContent>
            <LeadsChart data={d.series} description={rangeText} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Распределение по статусам</CardTitle>
          </CardHeader>
          <CardContent data-testid="status-distribution">
            <BarList
              total={d.total}
              items={LEAD_STATUSES.map((s) => ({ label: leadStatusMeta[s].label, count: d.byStatus[s], color: TONE_BAR[leadStatusMeta[s].tone] }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Популярные источники</CardTitle>
          </CardHeader>
          <CardContent data-testid="sources">
            <BarList total={d.total} items={d.sources.map((s) => ({ label: SOURCE_LABEL[s.key] ?? s.key, count: s.count }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Популярные услуги</CardTitle>
          </CardHeader>
          <CardContent data-testid="services">
            <BarList total={d.total} items={d.services.map((s) => ({ label: serviceTitle(s.key), count: s.count }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex! flex-row items-center justify-between">
            <CardTitle>Последние обращения</CardTitle>
            <Button variant="ghost" className="h-9" nativeButton={false} render={<Link href="/admin/leads" />}>
              Все заявки
            </Button>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState title="Заявок пока нет" description="Они появятся после первой отправки формы на сайте." />
            ) : (
              <ul className="divide-y">
                {recent.map((l) => (
                  <li key={l.id}>
                    <Link href={`/admin/leads/${l.id}`} className="flex items-start justify-between gap-3 py-3 hover:opacity-80">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{l.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {serviceTitle(l.serviceId)} · {dateTime(l.createdAt)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge tone={leadStatusMeta[l.status].tone}>{leadStatusMeta[l.status].label}</StatusBadge>
                        {l.sync.status !== "synced" && <StatusBadge tone={syncStatusMeta[l.sync.status].tone}>{syncStatusMeta[l.sync.status].label}</StatusBadge>}
                        {l.demoData && <StatusBadge tone="neutral">демо-запись</StatusBadge>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">Все показатели считаются по заявкам в базе данных, созданным в выбранный период (по московскому времени). Конверсия: успешно завершённые ÷ все заявки периода.</p>
    </>
  );
}
