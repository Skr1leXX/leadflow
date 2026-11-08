import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "./db";
import { createLead } from "./intake";
import { listLeads } from "./repo";
import { parseLeadInput } from "./schema";
import { judgeSubmission, MIN_FILL_MS, rateLimitHit } from "./spam";

const data = (over: Record<string, string> = {}) => {
  const r = parseLeadInput({ name: "Анна", phone: "89001234567", email: "a@example.com", serviceId: "automation", comment: "Нужна интеграция", ...over });
  assert.ok(r.ok);
  return r.data;
};

const emptyDb = () => openDatabase("file::memory:", { seed: false });

test("the same submission key stores one lead", async () => {
  const db = await emptyDb();
  const first = await createLead(db, data(), "key-aaaaaaaa");
  const again = await createLead(db, data(), "key-aaaaaaaa");
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.lead.id, first.lead.id);
  assert.equal((await listLeads(db)).length, 1);
});

test("identical content under a new key within 10 minutes is a duplicate, later it is not", async () => {
  const db = await emptyDb();
  const t = new Date("2026-06-15T12:00:00Z");
  const first = await createLead(db, data(), "key-aaaaaaaa", t);
  assert.equal((await createLead(db, data({ email: "A@Example.com" }), "key-bbbbbbbb", new Date(t.getTime() + 60_000))).lead.id, first.lead.id);
  assert.equal((await createLead(db, data(), "key-cccccccc", new Date(t.getTime() + 11 * 60_000))).duplicate, false);
  assert.equal((await createLead(db, data({ comment: "Другое" }), "key-dddddddd", t)).duplicate, false);
  assert.equal((await listLeads(db)).length, 3);
});

test("two requests with the same key at once store one lead", async () => {
  const db = await emptyDb();
  const results = await Promise.all([1, 2, 3, 4].map(() => createLead(db, data(), "key-racerace")));
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
  assert.equal(new Set(results.map((r) => r.lead.id)).size, 1);
  assert.equal((await listLeads(db)).length, 1);
});

test("a new lead starts as pending with no Bitrix24 ID", async () => {
  const db = await emptyDb();
  const { lead } = await createLead(db, data(), "key-aaaaaaaa");
  assert.equal(lead.sync.status, "pending");
  assert.equal(lead.sync.bitrixId, undefined);
  assert.equal(lead.source, "website");
});

test("honeypot and too-fast submissions are flagged", () => {
  const now = 1_000_000;
  assert.equal(judgeSubmission({ website: "http://spam", startedAt: now - 60_000 }, now), "honeypot");
  assert.equal(judgeSubmission({ startedAt: now - (MIN_FILL_MS - 1) }, now), "too_fast");
  assert.equal(judgeSubmission({}, now), "too_fast");
  assert.equal(judgeSubmission({ startedAt: now - 5_000 }, now), "ok");
});

test("the database rate limiter blocks after the limit, per key, and frees up after the window", async () => {
  const db = await emptyDb();
  assert.equal(await rateLimitHit(db, "ip", 2, 60_000, 0), 0);
  assert.equal(await rateLimitHit(db, "ip", 2, 60_000, 1_000), 0);
  assert.equal(await rateLimitHit(db, "ip", 2, 60_000, 2_000), 58);
  assert.equal(await rateLimitHit(db, "other", 2, 60_000, 2_000), 0);
  assert.equal(await rateLimitHit(db, "ip", 2, 60_000, 61_000), 0);
});

test("rate limit keys are stored hashed, not as the client address", async () => {
  const db = await emptyDb();
  await rateLimitHit(db, "lead|203.0.113.7", 5, 60_000, 0);
  const rows = await db.all("SELECT key FROM rate_limits");
  assert.equal(rows.length, 1);
  assert.ok(!String(rows[0].key).includes("203.0.113.7"));
});
