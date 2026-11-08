import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import AdminLoading from "@/app/admin/loading";
import { RuleControls } from "@/components/admin/rule-controls";
import { RuleForm } from "@/components/admin/rule-form";
import { AccessDenied } from "@/components/shared/access-denied";
import { DataTable, type Column } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageRules } from "@/features/auth/permissions";
import { requireUser } from "@/features/auth/session";
import { listAutomationLog, listRules, listStaff } from "@/features/leads/service";
import { serviceTitle } from "@/features/leads/services";
import type { AutomationLogEntry, RuleConfig, Staff } from "@/features/leads/types";
import { dateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Автоматизация" };

export default function AutomationPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <AutomationContent />
    </Suspense>
  );
}

function describe(c: RuleConfig, staff: Staff[]) {
  const name = (id?: string) => staff.find((s) => s.id === id)?.name ?? "неизвестный сотрудник";
  if (c.kind === "round_robin") return `По кругу: ${c.staffIds.map(name).join(", ")}`;
  const rows = Object.entries(c.assignments).map(([svc, id]) => `${serviceTitle(svc)} → ${name(id)}`);
  if (c.fallbackStaffId) rows.push(`остальные → ${name(c.fallbackStaffId)}`);
  return rows.join("; ");
}

const logColumns: Column<AutomationLogEntry>[] = [
  { header: "Время", cell: (e) => <span className="whitespace-nowrap">{dateTime(e.at)}</span> },
  { header: "Правило", cell: (e) => e.ruleName },
  {
    header: "Заявка",
    cell: (e) => (
      <Link href={`/admin/leads/${e.leadId}`} className="font-medium hover:text-primary">
        {e.leadName}
      </Link>
    ),
  },
  { header: "Результат", cell: (e) => <StatusBadge tone={e.ok ? "success" : "danger"}>{e.ok ? "Выполнено" : "Ошибка"}</StatusBadge> },
  { header: "Действие", cell: (e) => <span className="text-muted-foreground">{e.message}</span>, className: "hidden sm:table-cell" },
];

async function AutomationContent() {
  await connection();
  const user = await requireUser();
  if (!canManageRules(user)) return <AccessDenied />;

  const staff = listStaff();
  const active = staff.filter((s) => s.active);
  const rules = listRules();
  const log = listAutomationLog(50);

  return (
    <>
      <PageHeader title="Автоматизация" description="Правила назначения ответственного для новых заявок. Работают по порядку, побеждает первое подходящее." />

      <div className="space-y-4">
        {rules.length === 0 ? (
          <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Правил пока нет: новые заявки остаются без ответственного, пока их не назначит человек.</p>
        ) : (
          rules.map((r, i) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                    {r.name}
                  </p>
                  <p className="mt-0.5 text-sm break-words text-muted-foreground">{describe(r.config, staff)}</p>
                </div>
                <RuleControls id={r.id} name={r.name} enabled={r.enabled} />
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Новое правило</CardTitle>
        </CardHeader>
        <CardContent>
          <RuleForm staff={active.map((s) => ({ id: s.id, name: s.name }))} />
        </CardContent>
      </Card>

      <h2 className="mt-8 mb-3 text-lg font-semibold">История автоматических действий</h2>
      <DataTable columns={logColumns} rows={log} />
      <p className="mt-3 text-xs text-muted-foreground">
        Правила применяются к новой заявке сразу после её сохранения и только если ответственный ещё не назначен. В журнал попадают выполненные действия и ошибки.
      </p>
    </>
  );
}
