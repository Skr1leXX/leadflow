import type { Metadata } from "next";
import { Suspense } from "react";
import AdminLoading from "@/app/admin/loading";
import { ModeBanner } from "@/components/admin/mode-banner";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Topbar } from "@/components/layout/topbar";
import { FlashToast, ToastProvider } from "@/components/shared/toaster";
import { requireUser } from "@/features/auth/session";

export const metadata: Metadata = {
  title: { default: "LeadFlow", template: "%s · LeadFlow" },
  robots: { index: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}

/** Reads the session, so it sits inside Suspense; every page and action re-checks the role itself. */
async function AdminShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <ToastProvider>
      <div className="min-h-screen bg-background lg:grid lg:grid-cols-[16rem_1fr]">
        <aside className="sticky top-0 hidden h-screen lg:block">
          <SidebarNav role={user.role} />
        </aside>
        <div className="min-w-0">
          <Topbar user={{ name: user.name, role: user.role }} />
          <Suspense fallback={null}>
            <ModeBanner />
          </Suspense>
          <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
      <Suspense fallback={null}>
        <FlashToast />
      </Suspense>
    </ToastProvider>
  );
}
