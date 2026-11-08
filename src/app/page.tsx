import Link from "next/link";
import { LeadForm } from "@/components/site/lead-form";
import { LogoMark } from "@/components/shared/logo";

// Temporary public page: it hosts the lead form until the full company site is built.
export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
        <span className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <LogoMark /> LeadFlow
        </span>
        <Link href="/admin" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
          Панель управления
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Оставьте заявку</h1>
        <p className="mt-2 mb-8 text-muted-foreground">Расскажите, что нужно автоматизировать, и мы свяжемся с вами в рабочее время.</p>
        <div className="rounded-xl border bg-card p-5 sm:p-8">
          <LeadForm />
        </div>
      </main>
    </div>
  );
}
