import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { LeadData } from "./schema";
import * as repo from "./repo";
import type { Lead } from "./types";

const DUPLICATE_WINDOW_MS = 10 * 60_000;

const fingerprint = (d: LeadData) =>
  createHash("sha256").update([d.email.toLowerCase(), d.phone, d.serviceId, d.comment.toLowerCase()].join("|")).digest("hex");

export interface CreateResult {
  lead: Lead;
  /** True when this submission repeated an earlier one; nothing new was stored. */
  duplicate: boolean;
}

/**
 * Saves a website lead as "pending". It does not call Bitrix24: the caller schedules the send, so a slow or
 * unavailable portal never delays or loses the submission. Repeats (same key, or same content within 10 minutes)
 * return the original lead.
 */
export function createLead(db: DatabaseSync, data: LeadData, idempotencyKey: string, now = new Date()): CreateResult {
  const existing = repo.findByIdempotencyKey(db, idempotencyKey);
  if (existing) return { lead: existing, duplicate: true };

  const fp = fingerprint(data);
  const recent = repo.findRecentByFingerprint(db, fp, new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString());
  if (recent) return { lead: recent, duplicate: true };

  const lead: Lead = {
    id: `lead-${randomBytes(4).toString("hex")}`,
    name: data.name,
    phone: data.phone,
    email: data.email,
    serviceId: data.serviceId,
    comment: data.comment,
    status: "new",
    createdAt: now.toISOString(),
    source: "website",
    demoData: false,
    sync: { status: "pending", attempts: 0, demo: false },
  };
  try {
    repo.insertLead(db, lead, { idempotencyKey, fingerprint: fp });
  } catch (e) {
    // Two requests with the same key raced: the unique index let one in, so return that one.
    const winner = repo.findByIdempotencyKey(db, idempotencyKey);
    if (winner) return { lead: winner, duplicate: true };
    throw e;
  }
  return { lead, duplicate: false };
}
