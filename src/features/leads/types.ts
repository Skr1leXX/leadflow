import type { IntegrationMode } from "@/features/bitrix/client";

export const LEAD_STATUSES = ["new", "in_progress", "awaiting_reply", "won", "rejected"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** pending: waiting to be sent; sending: an attempt is in flight; synced: Bitrix24 confirmed; failed: last attempt failed. */
export const SYNC_STATUSES = ["pending", "sending", "synced", "failed"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export type Role = "admin" | "manager";

export interface Staff {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  /** ID of this person's user in Bitrix24; needed to make them the lead's responsible there. */
  bitrixUserId?: number;
}

export interface LeadSync {
  status: SyncStatus;
  /** ID of the lead in Bitrix24; set only after Bitrix24 confirmed the operation. */
  bitrixId?: number;
  attempts: number;
  /** ISO instant of the last attempt. */
  lastAttemptAt?: string;
  lastError?: string;
  lastErrorCode?: string;
  /** ISO instant when the background worker will try again; absent when only a manual retry can help. */
  nextRetryAt?: string;
  /** True when the outcome came from the built-in demo client, not from a real portal. */
  demo: boolean;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  /** Empty for manual leads taken by phone. */
  email: string;
  serviceId: string;
  comment: string;
  status: LeadStatus;
  /** Staff member responsible for the lead; undefined while unassigned. */
  assigneeId?: string;
  /** ISO instant. */
  createdAt: string;
  source: "website" | "manual";
  /** True for the fictional leads the demo seed creates; analytics can include or hide them. */
  demoData: boolean;
  sync: LeadSync;
}

export interface SyncEvent {
  id: string;
  leadId: string;
  leadName: string;
  /** ISO instant. */
  at: string;
  method: string;
  attempt: number;
  ok: boolean;
  bitrixId?: number;
  errorCode?: string;
  message: string;
  durationMs: number;
  demo: boolean;
}

export const TIMELINE_KINDS = ["status", "assignee", "comment", "automation", "created"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/** One entry in a lead's history: a change, a comment or an automatic action. */
export interface TimelineEntry {
  id: string;
  leadId: string;
  kind: TimelineKind;
  /** Staff ID; undefined for the system and for automation. */
  actorId?: string;
  actorName: string;
  at: string;
  /** Comment text, or the rule name for automatic actions. */
  body?: string;
  /** Human-readable before/after values for status and assignee changes. */
  from?: string;
  to?: string;
}

export const OUTBOX_KINDS = ["status", "assignee", "comment"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];
export type OutboxStatus = "pending" | "sending" | "done" | "failed";

/** A change made in LeadFlow that still has to reach (or has reached) Bitrix24. */
export interface OutboxItem {
  id: string;
  leadId: string;
  kind: OutboxKind;
  /** What to send: the lead status, a staff ID or the comment text. */
  payload: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  lastErrorCode?: string;
  nextRetryAt?: string;
  createdAt: string;
  doneAt?: string;
  demo: boolean;
}

export const RULE_KINDS = ["by_service", "round_robin"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export type RuleConfig =
  | { kind: "by_service"; assignments: Record<string, string>; fallbackStaffId?: string }
  | { kind: "round_robin"; staffIds: string[]; lastStaffId?: string };

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Rules run in ascending position; the first one that picks someone wins. */
  position: number;
  config: RuleConfig;
  createdAt: string;
}

export interface AutomationLogEntry {
  id: string;
  at: string;
  ruleId: string;
  ruleName: string;
  leadId: string;
  leadName: string;
  ok: boolean;
  message: string;
}

export interface IntegrationSettings {
  /** The webhook URL is a secret and lives in the environment, never here. */
  mode: IntegrationMode;
  autoSync: boolean;
  /** Bitrix24 user ID to assign new leads to when nobody is responsible in LeadFlow. */
  responsibleId: number;
  sourceId: string;
  notifyEmail: string;
  /** LeadFlow status -> STATUS_ID of the portal's lead funnel. Defaults fit the standard funnel. */
  statusMap: Record<LeadStatus, string>;
}
