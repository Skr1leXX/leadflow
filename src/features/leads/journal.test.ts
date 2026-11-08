import assert from "node:assert/strict";
import { test } from "node:test";
import { testDatabase } from "./test-db";
import { finishSync, getEvent, insertEvent, insertLead, getLead, queryEvents, type EventQuery } from "./repo";
import { enqueueOutbox, finishOutbox, listOutbox } from "./repo-workflow";
import type { Lead, SyncEvent } from "./types";

const ev = (id: string, at: string, over: Partial<SyncEvent> = {}): SyncEvent => ({
  id, leadId: "lead-a", leadName: "Анна", at: new Date(at).toISOString(), method: "crm.lead.add", attempt: 1, ok: true, message: "ok", durationMs: 10, demo: false, ...over,
});

const seed = async () => {
  const db = await testDatabase({ seed: false });
  await insertEvent(db, ev("e1", "2026-06-10T10:00:00+03:00", { bitrixId: 11 }));
  await insertEvent(db, ev("e2", "2026-06-11T10:00:00+03:00", { ok: false, errorCode: "TIMEOUT", message: "нет ответа", method: "crm.lead.update" }));
  await insertEvent(db, ev("e3", "2026-06-12T23:59:00+03:00", { method: "crm.timeline.comment.add", leadId: "lead-b" }));
  await insertEvent(db, ev("e4", "2026-06-13T00:00:00+03:00", { ok: false, leadId: "lead-b", attempt: 2 }));
  return db;
};
const ids = async (q: EventQuery) => (await queryEvents(await seed(), q)).rows.map((e) => e.id);

test("journal filters by status, operation type, local lead and date, newest first", async () => {
  assert.deepEqual(await ids({}), ["e4", "e3", "e2", "e1"]);
  assert.deepEqual(await ids({ status: "error" }), ["e4", "e2"]);
  assert.deepEqual(await ids({ status: "ok" }), ["e3", "e1"]);
  assert.deepEqual(await ids({ type: "crm.lead.update" }), ["e2"]);
  assert.deepEqual(await ids({ lead: "lead-b" }), ["e4", "e3"]);
  assert.deepEqual(await ids({ status: "error", lead: "lead-b" }), ["e4"]);
  assert.deepEqual(await ids({ from: "2026-06-12", to: "2026-06-12" }), ["e3"], "a Moscow day ends at its own midnight");
  assert.deepEqual(await ids({ from: "2026-06-13" }), ["e4"]);
  assert.deepEqual(await ids({ to: "2026-06-10" }), ["e1"]);
});

test("unknown filter values are ignored rather than executed", async () => {
  assert.equal((await queryEvents(await seed(), { status: "x'; DROP TABLE sync_events;--", type: "rm -rf", lead: "a b'", from: "yesterday" })).total, 4);
});

test("journal pages and clamps the page number", async () => {
  const db = await seed();
  const p = await queryEvents(db, { pageSize: 3, page: 2 });
  assert.deepEqual([p.rows.map((e) => e.id), p.pages, p.total], [["e1"], 2, 4]);
  assert.equal((await queryEvents(db, { pageSize: 3, page: 99 })).page, 2);
});

test("an entry keeps everything the journal must show", async () => {
  const db = await seed();
  const e = await getEvent(db, "e2");
  assert.deepEqual([e?.at, e?.method, e?.leadId, e?.ok, e?.attempt, e?.errorCode, e?.message], ["2026-06-11T07:00:00.000Z", "crm.lead.update", "lead-a", false, 1, "TIMEOUT", "нет ответа"]);
  assert.equal(await getEvent(db, e?.id + "x"), undefined);
});

test("secrets never reach the journal, the lead's error field or the outbox", async () => {
  const db = await testDatabase({ seed: false });
  const leaky = "request to https://p.bitrix24.ru/rest/5/AbCdEf123456/crm.lead.add.json failed, token=sup3rs3cr3t, Authorization: Bearer abcdef123456";
  const clean = (s: string | undefined) => {
    assert.ok(s);
    assert.ok(!/AbCdEf123456|sup3rs3cr3t|abcdef123456/.test(s), `leaked: ${s}`);
    assert.match(s, /\*\*\*/);
  };

  const lead: Lead = { id: "lead-x", name: "X", phone: "+79000000000", email: "", serviceId: "automation", comment: "", status: "new", createdAt: "2026-06-10T00:00:00.000Z", source: "website", demoData: false, sync: { status: "pending", attempts: 0, demo: false } };
  await insertLead(db, lead);
  await finishSync(db, "lead-x", { status: "failed", attempts: 1, lastError: leaky, lastErrorCode: "UNKNOWN", demo: false }, ev("e-leak", "2026-06-10T10:00:00Z", { ok: false, message: leaky }));
  clean((await getLead(db, "lead-x"))?.sync.lastError);
  clean((await getEvent(db, "e-leak"))?.message);

  await enqueueOutbox(db, { id: "ob1", leadId: "lead-x", kind: "status", payload: "won", createdAt: "2026-06-10T10:00:00Z" });
  await finishOutbox(db, "ob1", { status: "failed", attempts: 1, error: leaky, code: "UNKNOWN", demo: false });
  clean((await listOutbox(db, "lead-x"))[0].lastError);
});
