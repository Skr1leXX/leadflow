import type { Lead, Role } from "@/features/leads/types";

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

/** Areas of the admin panel. Admins reach all of them; managers only the day-to-day ones. */
export const AREAS = ["dashboard", "leads", "clients", "integration", "sync-log", "settings", "automation", "staff"] as const;
export type Area = (typeof AREAS)[number];

const MANAGER_AREAS: readonly Area[] = ["dashboard", "leads", "clients"];

export const canViewArea = (actor: Actor, area: Area) => actor.role === "admin" || MANAGER_AREAS.includes(area);

/**
 * Admins change any lead. A manager changes a lead only while it is unassigned or theirs, so one person cannot
 * quietly rework another's lead; they can still read it.
 */
export const canEditLead = (actor: Actor, lead: Pick<Lead, "assigneeId">) =>
  actor.role === "admin" || !lead.assigneeId || lead.assigneeId === actor.id;

/** Managers may hand over their own leads and take unassigned ones, but not pull a lead away from a colleague. */
export const canAssign = canEditLead;

export const canManageRules = (actor: Actor) => actor.role === "admin";
export const canManageStaff = (actor: Actor) => actor.role === "admin";
export const canManageIntegration = (actor: Actor) => actor.role === "admin";
