import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import AdminLoading from "@/app/admin/loading";
import { StaffForm, StaffRowControls } from "@/components/admin/staff-controls";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageStaff } from "@/features/auth/permissions";
import { requireUser } from "@/features/auth/session";
import { listStaff } from "@/features/leads/service";

export const metadata: Metadata = { title: "Сотрудники" };

export default function StaffPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <StaffContent />
    </Suspense>
  );
}

async function StaffContent() {
  await connection();
  const user = await requireUser();
  if (!canManageStaff(user)) return <AccessDenied />;
  const staff = listStaff();

  return (
    <>
      <PageHeader title="Сотрудники" description="Кто может войти в панель и кого можно назначать ответственным" />
      <div className="space-y-3">
        {staff.map((s) => (
          <Card key={s.id}>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar name={s.name} className="size-10" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {s.name}
                    <StatusBadge tone={s.role === "admin" ? "info" : "neutral"}>{s.role === "admin" ? "Администратор" : "Менеджер"}</StatusBadge>
                    {s.id === user.id && <span className="text-xs font-normal text-muted-foreground">это вы</span>}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{s.email}</p>
                </div>
              </div>
              <StaffRowControls id={s.id} name={s.name} active={s.active} bitrixUserId={s.bitrixUserId} isSelf={s.id === user.id} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6 max-w-3xl">
        <CardHeader>
          <CardTitle>Новый сотрудник</CardTitle>
        </CardHeader>
        <CardContent>
          <StaffForm />
        </CardContent>
      </Card>
      <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
        Отключённый сотрудник не может войти, исчезает из списка для назначения и не участвует в правилах автоматизации. Его заявки остаются за ним, пока их не передадут другому.
      </p>
    </>
  );
}
