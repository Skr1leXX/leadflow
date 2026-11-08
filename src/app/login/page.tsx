import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/shared/logo";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser, sessionConfigured } from "@/features/auth/session";
import { accountConfig, DEMO_STAFF } from "@/features/leads/db";

export const metadata: Metadata = { title: "Вход", robots: { index: false } };

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <Suspense fallback={null}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginContent({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await connection();
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect("/admin");
  const accounts = accountConfig(process.env);
  const prod = process.env.NODE_ENV === "production";

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5 text-xl font-semibold tracking-tight">
          <LogoMark /> LeadFlow
        </div>
        <div className="rounded-xl border bg-card p-6">
          <h1 className="text-lg font-semibold">Вход в панель управления</h1>
          {!sessionConfigured() && (
            <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              Вход не настроен: задайте LEADFLOW_SESSION_SECRET (не короче 16 символов) и перезапустите сервер.
            </p>
          )}
          <LoginForm next={next ?? ""} />
        </div>
        {accounts.showDemoLogins && (
          <div role="note" data-testid="demo-logins" className="mt-4 rounded-lg bg-warning/15 p-3 text-xs">
            <p className="font-medium">Демонстрационный доступ</p>
            <ul className="mt-1 space-y-0.5">
              {DEMO_STAFF.filter((s) => s.role === "manager" || !prod || accounts.adminPassword === accounts.demoPassword).map((s) => (
                <li key={s.id}>
                  <b>{s.email}</b> — {s.role === "admin" ? "администратор" : "менеджер"}
                  {!prod && s.role === "admin" && accounts.adminPassword !== accounts.demoPassword ? `, пароль: ${accounts.adminPassword}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              Пароль: <b>{accounts.demoPassword}</b>
            </p>
            {prod && <p className="mt-1 text-muted-foreground">Это демонстрационный стенд: данные вымышленные, заявки в настоящий Битрикс24 не уходят.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
