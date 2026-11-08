import { Bot, Contact, History, Inbox, LayoutDashboard, Plug, Settings, Users } from "lucide-react";
import type { Area } from "@/features/auth/permissions";

export const nav: { href: string; label: string; icon: typeof Inbox; area: Area }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, area: "dashboard" },
  { href: "/admin/leads", label: "Заявки", icon: Inbox, area: "leads" },
  { href: "/admin/clients", label: "Клиенты", icon: Contact, area: "clients" },
  { href: "/admin/automation", label: "Автоматизация", icon: Bot, area: "automation" },
  { href: "/admin/integration", label: "Битрикс24", icon: Plug, area: "integration" },
  { href: "/admin/sync-log", label: "История синхронизации", icon: History, area: "sync-log" },
  { href: "/admin/staff", label: "Сотрудники", icon: Users, area: "staff" },
  { href: "/admin/settings", label: "Настройки", icon: Settings, area: "settings" },
];
