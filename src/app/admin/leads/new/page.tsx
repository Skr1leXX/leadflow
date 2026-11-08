import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import AdminLoading from "@/app/admin/loading";
import { NewLeadForm } from "@/components/admin/new-lead-form";
import { PageHeader } from "@/components/shared/page-header";
import { requireUser } from "@/features/auth/session";
import { listStaff } from "@/features/leads/service";

export const metadata: Metadata = { title: "Новая заявка" };

export default function NewLeadPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <NewLeadContent />
    </Suspense>
  );
}

async function NewLeadContent() {
  await connection();
  const user = await requireUser();
  const staff = (await listStaff()).filter((s) => s.active && (user.role === "admin" || s.id === user.id));

  return (
    <>
      <Link href="/admin/leads" className="mb-3 inline-flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Все заявки
      </Link>
      <PageHeader title="Новая заявка" description="Для обращений по телефону, в мессенджерах и на встречах. Заявка попадёт в тот же список и в Битрикс24." />
      <NewLeadForm idempotencyKey={randomUUID()} staff={staff.map((s) => ({ id: s.id, name: s.name }))} lockedAssigneeId={user.role === "admin" ? undefined : user.id} />
    </>
  );
}
