"use client";

import { useState } from "react";
import { LogOut, Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/shared/user-avatar";
import { logoutAction } from "@/features/auth/actions";
import type { Role } from "@/features/leads/types";
import { SidebarNav } from "./sidebar-nav";

const ROLE_LABEL: Record<Role, string> = { admin: "Администратор", manager: "Менеджер" };

export function Topbar({ user }: { user: { name: string; role: Role } }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon" className="size-11 lg:hidden" aria-label="Меню" />}>
          <Menu />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Навигация</SheetTitle>
          <SidebarNav role={user.role} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <form action="/admin/leads" className="relative max-w-md flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" aria-label="Поиск по заявкам" placeholder="Поиск по заявкам" className="h-10 bg-card pl-9" />
      </form>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right text-sm leading-tight sm:block">
          <p className="font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</p>
        </div>
        <UserAvatar name={user.name} className="size-9" />
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="icon" className="size-10" aria-label="Выйти" title="Выйти">
            <LogOut />
          </Button>
        </form>
      </div>
    </header>
  );
}
