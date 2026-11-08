import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "./db";
import { createLead } from "./intake";
import { listLeads } from "./repo";
import { parseLeadInput } from "./schema";
import { createRateLimiter, judgeSubmission, MIN_FILL_MS } from "./spam";

const data = (over: Record<string, string> = {}) => {
  const r = parseLeadInput({ name: "Анна", phone: "89001234567", email: "a@example.com", serviceId: "automation", comment: "Нужна интеграция", ...over });
  assert.ok(r.ok);
  return r.data;
};

test("the same submission key stores one lead", () => {
  const db = openDatabase(":memory:", { seed: false });
  const first = createLead(db, data(), "key-aaaaaaaa");
  const again = createLead(db, data(), "key-aaaaaaaa");
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.lead.id, first.lead.id);
  assert.equal(listLeads(db).length, 1);
});

test("identical content under a new key within 10 minutes is a duplicate, later it is not", () => {
  const db = openDatabase(":memory:", { seed: false });
  const t = new Date("2026-06-15T12:00:00Z");
  const first = createLead(db, data(), "key-aaaaaaaa", t);
  assert.equal(createLead(db, data({ email: "A@Example.com" }), "key-bbbbbbbb", new Date(t.getTime() + 60_000)).lead.id, first.lead.id);
  assert.equal(createLead(db, data(), "key-cccccccc", new Date(t.getTime() + 11 * 60_000)).duplicate, false);
  assert.equal(createLead(db, data({ comment: "Другое" }), "key-dddddddd", t).duplicate, false);
  assert.equal(listLeads(db).length, 3);
});

test("a new lead starts as pending with no Bitrix24 ID", () => {
  const db = openDatabase(":memory:", { seed: false });
  const { lead } = createLead(db, data(), "key-aaaaaaaa");
  assert.equal(lead.sync.status, "pending");
  assert.equal(lead.sync.bitrixId, undefined);
  assert.equal(lead.source, "website");
});

test("honeypot and too-fast submissions are flagged", () => {
  const now = 1_000_000;
  assert.equal(judgeSubmission({ website: "http://spam" , startedAt: now - 60_000 }, now), "honeypot");
  assert.equal(judgeSubmission({ startedAt: now - (MIN_FILL_MS - 1) }, now), "too_fast");
  assert.equal(judgeSubmission({}, now), "too_fast");
  assert.equal(judgeSubmission({ startedAt: now - 5_000 }, now), "ok");
});

test("rate limiter blocks after the limit and frees up after the window", () => {
  const rl = createRateLimiter(2, 60_000);
  assert.equal(rl.hit("ip", 0), 0);
  assert.equal(rl.hit("ip", 1_000), 0);
  assert.equal(rl.hit("ip", 2_000), 58);
  assert.equal(rl.hit("other", 2_000), 0);
  assert.equal(rl.hit("ip", 61_000), 0);
});
