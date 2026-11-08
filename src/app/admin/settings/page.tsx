import type { Metadata } from "next";
import { connection } from "next/server";
import { AccessDenied } from "@/components/shared/access-denied";
import { canManageIntegration } from "@/features/auth/permissions";
import { requireUser } from "@/features/auth/session";
import { SettingsForm } from "@/components/admin/settings-form";
import { PageHeader } from "@/components/shared/page-header";
import { getSettings } from "@/features/leads/service";

export const metadata: Metadata = { title: "Настройки" };

export default async function SettingsPage() {
  await connection();
  if (!canManageIntegration(await requireUser())) return <AccessDenied />;
  return (
    <>
      <PageHeader title="Настройки" description="Параметры передачи заявок в Битрикс24" />
      <SettingsForm initial={getSettings()} />
    </>
  );
}
