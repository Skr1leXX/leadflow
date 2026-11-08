import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { DataTable, type Column } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { requireUser } from "@/features/auth/session";
import { clientsFromLeads, type Client } from "@/features/clients/clients";
import { listLeads } from "@/features/leads/service";
import { serviceTitle } from "@/features/leads/services";
import { dateShort } from "@/lib/format";

export const metadata: Metadata = { title: "Клиенты" };

const columns: Column<Client>[] = [
  {
    header: "Клиент",
    cell: (c) => (
      <div className="flex items-center gap-3">
        <UserAvatar name={c.name} className="size-8" />
        <div className="min-w-0">
          <p className="truncate font-medium">{c.name}</p>
          <p className="truncate text-xs text-muted-foreground">{c.email || "без почты"}</p>
        </div>
      </div>
    ),
  },
  { header: "Телефон", cell: (c) => <span className="whitespace-nowrap">{c.phone}</span>, className: "hidden md:table-cell" },
  { header: "Последняя услуга", cell: (c) => serviceTitle(c.lastServiceId), className: "hidden lg:table-cell" },
  { header: "Обращений", cell: (c) => <Link href={`/admin/leads?q=${encodeURIComponent(c.email || c.phone)}`} className="font-medium text-primary hover:underline">{c.leadsCount}</Link> },
  { header: "Последнее", cell: (c) => <span className="whitespace-nowrap">{dateShort(c.lastLeadAt)}</span>, className: "hidden sm:table-cell" },
];

export default async function ClientsPage() {
  await connection();
  await requireUser();
  const clients = clientsFromLeads(listLeads());
  return (
    <>
      <PageHeader title="Клиенты" description="Контакты, собранные из заявок. Одинаковая почта считается одним клиентом." />
      <DataTable columns={columns} rows={clients} />
    </>
  );
}
