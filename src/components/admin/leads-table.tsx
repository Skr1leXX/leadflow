import Link from "next/link";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DemoTag } from "@/components/shared/demo-tag";
import { StatusBadge } from "@/components/shared/status-badge";
import { serviceTitle } from "@/features/leads/services";
import { leadStatusMeta, syncStatusMeta } from "@/features/leads/status-meta";
import type { Lead, Staff } from "@/features/leads/types";
import { dateTime } from "@/lib/format";

/** Read-only table; each row opens the lead's card, where all changes are made. */
export function LeadsTable({ leads, staff }: { leads: Lead[]; staff: Staff[] }) {
  const names = new Map(staff.map((s) => [s.id, s.name]));

  const columns: Column<Lead>[] = [
    {
      header: "Имя",
      cell: (l) => (
        <Link href={`/admin/leads/${l.id}`} className="block min-h-9 hover:text-primary">
          <span className="block font-medium">{l.name}</span>
          <span className="block text-xs text-muted-foreground md:hidden">{l.phone}</span>
        </Link>
      ),
    },
    { header: "Телефон", cell: (l) => <span className="whitespace-nowrap">{l.phone}</span>, className: "hidden md:table-cell" },
    { header: "Email", cell: (l) => l.email || <span className="text-muted-foreground">—</span>, className: "hidden xl:table-cell" },
    { header: "Услуга", cell: (l) => serviceTitle(l.serviceId), className: "hidden lg:table-cell" },
    { header: "Источник", cell: (l) => (l.source === "website" ? "Сайт" : "Вручную"), className: "hidden xl:table-cell" },
    {
      header: "Ответственный",
      cell: (l) => (l.assigneeId ? (names.get(l.assigneeId) ?? "—") : <span className="text-muted-foreground">не назначен</span>),
      className: "hidden sm:table-cell",
    },
    {
      header: "Статус",
      cell: (l) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={leadStatusMeta[l.status].tone}>{leadStatusMeta[l.status].label}</StatusBadge>
          {l.sync.status !== "synced" && <StatusBadge tone={syncStatusMeta[l.sync.status].tone}>{syncStatusMeta[l.sync.status].label}</StatusBadge>}
          {l.sync.demo && l.sync.status === "synced" && <DemoTag />}
          {l.demoData && <StatusBadge tone="neutral">демо-запись</StatusBadge>}
        </span>
      ),
    },
    { header: "Создана", cell: (l) => <span className="whitespace-nowrap">{dateTime(l.createdAt)}</span>, className: "hidden sm:table-cell" },
  ];

  return <DataTable columns={columns} rows={leads} />;
}
