import assert from "node:assert/strict";
import { test } from "node:test";
import { BitrixError, type BitrixClient, type BitrixLeadFields } from "@/features/bitrix/client";
import { MockBitrixClient } from "@/features/bitrix/mock-client";
import { testDatabase } from "./test-db";
import { createLead } from "./intake";
import { getLead, listEventsForLead } from "./repo";
import { parseLeadInput } from "./schema";
import { processDueRetries, runLeadSync } from "./sync-runner";
import { DEFAULT_STATUS_MAP } from "./defaults";
import type { Db } from "./sql";
import type { IntegrationSettings } from "./types";

const settings: IntegrationSettings = { mode: "demo", autoSync: true, responsibleId: 1, sourceId: "WEB", notifyEmail: "", statusMap: DEFAULT_STATUS_MAP };
const mock = () => new MockBitrixClient({ latencyMs: 0 });
const fresh = () => testDatabase({ seed: false });

let n = 0;
async function submit(db: Db, email = "a@example.com", comment = "") {
  const r = parseLeadInput({ name: "Анна", phone: "89001234567", email, serviceId: "automation", comment: `${comment}#${++n}` });
  assert.ok(r.ok);
  return (await createLead(db, r.data, `key-${n}-abcdefgh`)).lead;
}

/** A client that records calls and can simulate "created, but the answer was lost". */
function spyClient(behaviour: { loseAnswerOnce?: boolean; error?: BitrixError } = {}) {
  const calls = { create: 0, find: 0 };
  const origins = new Map<string, number>();
  let lost = behaviour.loseAnswerOnce ?? false;
  const client: BitrixClient = {
    demo: false,
    async findLeadByOrigin(o) {
      calls.find++;
      return origins.get(o) ?? null;
    },
    async createLead(f: BitrixLeadFields) {
      calls.create++;
      if (behaviour.error) throw behaviour.error;
      origins.set(f.ORIGIN_ID, 900 + calls.create);
      if (lost) {
        lost = false;
        throw new BitrixError("Портал не ответил за 10 с", "TIMEOUT");
      }
      return { id: 900 + calls.create };
    },
    async updateLead() {},
    async addLeadComment() {
      return { id: 1 };
    },
    async getPortalInfo() {
      throw new Error("unused");
    },
  };
  return { client, calls };
}

test("a saved lead is sent once and marked as a demo outcome", async () => {
  const db = await fresh();
  const lead = await submit(db);
  assert.equal(lead.sync.status, "pending");

  const res = await runLeadSync({ db, client: mock(), settings }, lead.id);
  assert.ok(res.claimed);
  const saved = (await getLead(db, lead.id))!;
  assert.equal(saved.sync.status, "synced");
  assert.equal(saved.sync.demo, true);
  assert.ok(saved.sync.bitrixId);
  const events = (await listEventsForLead(db, lead.id));
  assert.equal(events.length, 1);
  assert.equal(events[0].demo, true);
});

test("a synced lead is never sent again, even by parallel callers", async () => {
  const db = await fresh();
  const lead = await submit(db);
  const { client, calls } = spyClient();

  const results = await Promise.all([1, 2, 3].map(() => runLeadSync({ db, client, settings }, lead.id)));
  assert.equal(results.filter((r) => r.claimed).length, 1, "only one caller wins the claim");
  assert.equal((await runLeadSync({ db, client, settings }, lead.id)).claimed, false, "synced lead is not claimable");
  assert.equal(calls.create, 1);
  assert.equal((await getLead(db, lead.id))!.sync.demo, false);
});

test("failure keeps the lead, records the error and schedules a retry", async () => {
  const db = await fresh();
  const lead = await submit(db, "x@bitrix-error.test");
  const now = new Date("2026-06-15T12:00:00Z");
  await runLeadSync({ db, client: mock(), settings, now: () => now }, lead.id);

  const saved = (await getLead(db, lead.id))!;
  assert.equal(saved.sync.status, "failed");
  assert.equal(saved.sync.bitrixId, undefined, "not synced until Bitrix24 confirms");
  assert.equal(saved.sync.lastErrorCode, "QUERY_LIMIT_EXCEEDED");
  assert.equal(saved.sync.nextRetryAt, "2026-06-15T12:01:00.000Z");
  assert.equal((await listEventsForLead(db, lead.id))[0].ok, false);
});

test("the worker retries a transient failure until it succeeds", async () => {
  const db = await fresh();
  const lead = await submit(db, "x@bitrix-flaky.test");
  const t0 = new Date("2026-06-15T12:00:00Z");
  await runLeadSync({ db, client: mock(), settings, now: () => t0 }, lead.id);
  assert.equal((await getLead(db, lead.id))!.sync.status, "failed");

  const tooEarly = await processDueRetries({ db, client: mock(), settings, now: () => new Date(t0.getTime() + 30_000) });
  assert.equal(tooEarly, 0, "not due yet");

  const due = await processDueRetries({ db, client: mock(), settings, now: () => new Date(t0.getTime() + 61_000) });
  assert.equal(due, 1);
  const saved = (await getLead(db, lead.id))!;
  assert.equal(saved.sync.status, "synced");
  assert.equal(saved.sync.attempts, 2);
  assert.equal((await listEventsForLead(db, lead.id)).length, 2, "both attempts are journaled");
});

test("a lost answer does not create a duplicate lead on retry", async () => {
  const db = await fresh();
  const lead = await submit(db);
  const { client, calls } = spyClient({ loseAnswerOnce: true });

  await runLeadSync({ db, client, settings }, lead.id);
  assert.equal((await getLead(db, lead.id))!.sync.status, "failed");

  await runLeadSync({ db, client, settings }, lead.id);
  const saved = (await getLead(db, lead.id))!;
  assert.equal(saved.sync.status, "synced");
  assert.equal(calls.create, 1, "the second attempt adopted the existing lead");
  assert.equal(saved.sync.bitrixId, 901);
});

test("errors that need a person are not retried automatically", async () => {
  const db = await fresh();
  const lead = await submit(db);
  const { client } = spyClient({ error: new BitrixError("нет прав", "INSUFFICIENT_SCOPE") });
  const t0 = new Date("2026-06-15T12:00:00Z");
  await runLeadSync({ db, client, settings, now: () => t0 }, lead.id);

  const saved = (await getLead(db, lead.id))!;
  assert.equal(saved.sync.status, "failed");
  assert.equal(saved.sync.nextRetryAt, undefined);
  assert.equal(await processDueRetries({ db, client, settings, now: () => new Date(t0.getTime() + 7 * 24 * 3_600_000) }), 0);
  assert.equal((await runLeadSync({ db, client: mock(), settings }, lead.id)).claimed, true, "manual retry still works");
});

test("a crashed attempt is recovered once its lock goes stale", async () => {
  const db = await fresh();
  const lead = await submit(db);
  const t0 = new Date("2026-06-15T12:00:00Z");
  await db.run("UPDATE leads SET sync_status = 'sending', sync_locked_at = ? WHERE id = ?", [t0.toISOString(), lead.id]);

  const early = { db, client: mock(), settings, now: () => new Date(t0.getTime() + 60_000) };
  assert.equal((await runLeadSync(early, lead.id)).claimed, false, "a live attempt keeps its lock");
  assert.equal(await processDueRetries({ ...early, now: () => new Date(t0.getTime() + 4 * 60_000) }), 1);
  assert.equal((await getLead(db, lead.id))!.sync.status, "synced");
});

test("a lead sent only to the demo client can be resent once live mode is on", async () => {
  const db = await fresh();
  const lead = await submit(db);
  await runLeadSync({ db, client: mock(), settings }, lead.id);
  const { client, calls } = spyClient();

  assert.equal((await runLeadSync({ db, client, settings }, lead.id)).claimed, false);
  assert.equal((await runLeadSync({ db, client, settings }, lead.id, { resendDemo: true })).claimed, true);
  const saved = (await getLead(db, lead.id))!;
  assert.equal(saved.sync.demo, false);
  assert.equal(calls.create, 1);
});
