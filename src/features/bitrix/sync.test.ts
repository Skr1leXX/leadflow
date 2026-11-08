import assert from "node:assert/strict";
import { test } from "node:test";
import { MockBitrixClient } from "./mock-client";
import { toBitrixLead } from "./mapper";
import { syncLead } from "./sync";
import { DEFAULT_STATUS_MAP } from "../leads/defaults";
import type { IntegrationSettings, Lead } from "../leads/types";

const settings: IntegrationSettings = { mode: "demo", autoSync: true, responsibleId: 7, sourceId: "WEB", notifyEmail: "", statusMap: DEFAULT_STATUS_MAP };
let seq = 0;
const lead = (email: string): Lead => ({
  id: `l${++seq}`, name: "Анна", phone: "+79001234567", email, serviceId: "automation", comment: "Нужна интеграция",
  status: "new", createdAt: "2026-01-01T10:00:00Z", source: "website", demoData: false, sync: { status: "pending", attempts: 0, demo: false },
});

test("maps a lead to crm.lead.add fields", () => {
  const f = toBitrixLead(lead("a@b.ru"), settings);
  assert.equal(f.NAME, "Анна");
  assert.equal(f.PHONE[0].VALUE, "+79001234567");
  assert.equal(f.ASSIGNED_BY_ID, 7);
  assert.match(f.COMMENTS, /Нужна интеграция/);
});

test("successful sync stores the Bitrix ID", async () => {
  const r = await syncLead(lead("a@b.ru"), new MockBitrixClient({ latencyMs: 0, firstId: 10 }), settings);
  assert.deepEqual({ ...r.sync, lastAttemptAt: undefined }, { status: "synced", bitrixId: 10, attempts: 1, lastAttemptAt: undefined, demo: true });
  assert.equal(r.event.ok, true);
});

test("failed sync keeps the error and counts the attempt", async () => {
  const r = await syncLead(lead("a@bitrix-error.test"), new MockBitrixClient({ latencyMs: 0 }), settings);
  assert.equal(r.sync.status, "failed");
  assert.equal(r.sync.attempts, 1);
  assert.equal(r.sync.lastErrorCode, "QUERY_LIMIT_EXCEEDED");
  assert.match(r.sync.lastError ?? "", /^Демо: /);
  assert.equal(r.event.ok, false);
});
