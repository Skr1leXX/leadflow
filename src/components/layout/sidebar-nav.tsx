"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/shared/logo";
import { canViewArea } from "@/features/auth/permissions";
import type { Role } from "@/features/leads/types";
import { nav } from "./nav";

export function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col border-r bg-sidebar text-sidebar-foreground">
      <Link href="/admin" onClick={onNavigate} className="flex h-16 items-center gap-2.5 px-5">
        <LogoMark />
        <span className="text-lg font-semibold tracking-tight text-foreground">LeadFlow</span>
      </Link>
      <nav aria-label="Разделы" className="flex-1 space-y-1 px-3 py-2">
        {nav.filter((n) => canViewArea({ id: "", name: "", role }, n.area)).map(({ href, label, icon: Icon }) => {
          const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className={cn("size-4", active && "text-sidebar-primary")} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 border-t p-3 text-sm">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg px-3 py-2.5 font-medium hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="size-4" /> Публичный сайт
        </Link>
        <p className="px-3 pt-1 text-xs text-muted-foreground">Данные хранятся в локальной базе SQLite</p>
      </div>
    </div>
  );
}
