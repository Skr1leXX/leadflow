import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { hashPassword, verifyPassword } from "@/features/auth/password";
import { canEditLead, canViewArea, type Actor } from "@/features/auth/permissions";
import { signSession, verifySession, SESSION_TTL_MS } from "@/features/auth/token";
import { BitrixError, type BitrixClient } from "@/features/bitrix/client";
import { applyAutomation, pickAssignee } from "./automation";
import { addComment, assignLead, changeStatus, createManualLead } from "./commands";
import { DEFAULT_STATUS_MAP } from "./defaults";
import { openDatabase } from "./db";
import { createLead } from "./intake";
import { MIGRATIONS, migrate } from "./migrations";
import { processOutbox, sendOutboxItem } from "./outbox";
import * as repo from "./repo";
import * as wf from "./repo-workflow";
import { parseLeadInput, manualLeadSchema } from "./schema";
import { runLeadSync } from "./sync-runner";
import type { AutomationRule, IntegrationSettings } from "./types";

const settings: IntegrationSettings = { mode: "demo", autoSync: true, responsibleId: 1, sourceId: "WEB", notifyEmail: "", statusMap: DEFAULT_STATUS_MAP };
const T0 = new Date("2026-06-15T12:00:00Z");

const testDb = () => openDatabase(":memory:", { seed: false, adminPassword: "admin-pass", demoPassword: "demo-pass" });
const admin: Actor = { id: "staff-admin", name: "Администратор", role: "admin" };
const olga: Actor = { id: "staff-olga", name: "Ольга Смирнова", role: "manager" };
const denis: Actor = { id: "staff-denis", name: "Денис Климов", role: "manager" };

let n = 0;
function website(db: DatabaseSync, over: Record<string, string> = {}, at = T0) {
  const r = parseLeadInput({ name: "Анна Воронцова", phone: "89001234567", email: `a${++n}@example.com`, serviceId: "automation", comment: `c${n}`, ...over });
  assert.ok(r.ok);
  return createLead(db, r.data, `key-${n}-abcdefgh`, at).lead;
}

/** Records what reaches the portal. */
function spy(opts: { demo?: boolean; fail?: BitrixError } = {}) {
  const calls: string[] = [];
  const client: BitrixClient = {
    demo: opts.demo ?? false,
    async findLeadByOrigin() { return null; },
    async createLead() { calls.push("add"); return { id: 500 }; },
    async updateLead(id, ch) { if (opts.fail) throw opts.fail; calls.push(`update ${id} ${JSON.stringify(ch)}`); },
    async addLeadComment(id, text) { if (opts.fail) throw opts.fail; calls.push(`comment ${id} ${text}`); return { id: 1 }; },
    async getPortalInfo() { throw new Error("unused"); },
  };
  return { client, calls };
}
async function synced(db: DatabaseSync, id: string, demo = false) {
  await runLeadSync({ db, client: spy({ demo }).client, settings, now: () => T0 }, id);
}

// ---- auth --------------------------------------------------------------------------------------------------------

test("passwords verify only against the right secret", () => {
  const h = hashPassword("correct horse");
  assert.ok(verifyPassword("correct horse", h));
  assert.ok(!verifyPassword("wrong", h));
  assert.ok(!verifyPassword("x", "garbage"));
  assert.notEqual(hashPassword("same"), hashPassword("same"), "each hash has its own salt");
});

test("session tokens reject tampering, a wrong secret and expiry", () => {
  const tok = signSession("staff-olga", "secret", 1000);
  assert.equal(verifySession(tok, "secret", 2000), "staff-olga");
  assert.equal(verifySession(tok, "other", 2000), null);
  assert.equal(verifySession(tok.replace(/^./, "x"), "secret", 2000), null);
  assert.equal(verifySession(undefined, "secret"), null);
  assert.equal(verifySession(tok, "secret", 1000 + SESSION_TTL_MS + 1), null);
});

test("permission matrix", () => {
  assert.ok(canViewArea(admin, "settings"));
  assert.ok(!canViewArea(olga, "settings"));
  assert.ok(!canViewArea(olga, "automation"));
  assert.ok(canViewArea(olga, "leads"));
  assert.ok(canEditLead(olga, {}), "unassigned leads can be taken");
  assert.ok(canEditLead(olga, { assigneeId: olga.id }));
  assert.ok(!canEditLead(olga, { assigneeId: denis.id }));
  assert.ok(canEditLead(admin, { assigneeId: denis.id }));
});

// ---- migrations --------------------------------------------------------------------------------------------------

test("migrating an existing v1 database keeps its leads and renames the old status", () => {
  const db = new DatabaseSync(":memory:");
  MIGRATIONS[0].up(db); // the schema as shipped before this stage
  db.exec("INSERT INTO leads (id,name,phone,email,service_id,comment,status,created_at,source,sync_status) VALUES ('l1','Анна','+79001112233','a@x.ru','automation','','processed','2026-01-01T00:00:00Z','website','synced')");
  const applied = migrate(db);
  assert.deepEqual(applied, [1, 2, 3], "migration 1 is idempotent on an existing schema");
  const row = db.prepare("SELECT status, search, assignee_id, demo_data FROM leads WHERE id = 'l1'").get();
  assert.equal(row?.status, "won");
  assert.match(row?.search as string, /анна/);
  assert.equal(row?.assignee_id, null);
  assert.equal(row?.demo_data, 0, "real leads are not marked as demo data");
  assert.deepEqual(migrate(db), [], "nothing is applied twice");
});

// ---- list query --------------------------------------------------------------------------------------------------

test("list search is case-blind for Cyrillic and matches name, phone and email", () => {
  const db = testDb();
  const a = website(db, { name: "Анна Воронцова", phone: "89001112233", email: "anna@example.com" });
  website(db, { name: "Борис Орлов", phone: "89004445566", email: "boris@example.com" });
  const ids = (q: string) => repo.queryLeads(db, { q }).rows.map((l) => l.id);
  assert.deepEqual(ids("АННА"), [a.id]);
  assert.deepEqual(ids("воронц"), [a.id]);
  assert.deepEqual(ids("900 111-22"), [a.id]);
  assert.deepEqual(ids("+7 (900) 444"), [ids("борис")[0]]);
  assert.deepEqual(ids("anna@EXAMPLE"), [a.id]);
  assert.deepEqual(ids("100%"), [], "LIKE wildcards are literal");
  assert.equal(ids("").length, 2);
});

test("filters, sorting and paging", () => {
  const db = testDb();
  const day = (d: number) => new Date(T0.getTime() + d * 86_400_000);
  const l1 = website(db, { name: "Яков" }, day(0));
  const l2 = website(db, { name: "Алла" }, day(1));
  const l3 = website(db, { name: "Борис" }, day(2));
  changeStatus(db, admin, l1.id, "won", T0);
  assignLead(db, admin, l2.id, "staff-olga", T0);
  createManualLead(db, admin, manualLeadSchema.parse({ name: "Вера", phone: "89007778899", email: "", serviceId: "support", comment: "" }), "mkey-12345678", day(3));

  const q = (p: repo.LeadQuery) => repo.queryLeads(db, p);
  assert.deepEqual(q({ status: "won" }).rows.map((l) => l.id), [l1.id]);
  assert.equal(q({ source: "manual" }).total, 1);
  assert.equal(q({ source: "website" }).total, 3);
  assert.deepEqual(q({ assignee: "staff-olga" }).rows.map((l) => l.id), [l2.id]);
  assert.equal(q({ assignee: "none" }).total, 3);
  assert.deepEqual(q({ from: "2026-06-16", to: "2026-06-17" }).rows.map((l) => l.id).sort(), [l2.id, l3.id].sort());
  assert.deepEqual(q({ sort: "name", dir: "asc" }).rows.map((l) => l.name), ["Алла", "Борис", "Вера", "Яков"]);
  assert.equal(q({ status: "nonsense; DROP TABLE leads" }).total, 4, "unknown filter values are ignored, not executed");

  const paged = q({ pageSize: 3, page: 2 });
  assert.equal(paged.rows.length, 1);
  assert.equal(paged.pages, 2);
  assert.equal(q({ pageSize: 3, page: 99 }).page, 2, "page is clamped");
});

// ---- commands and permissions -----------------------------------------------------------------------------------

test("a status change is saved, recorded in the history and queued for Bitrix24 together", () => {
  const db = testDb();
  const lead = website(db);
  const r = changeStatus(db, olga, lead.id, "in_progress", T0);
  assert.ok(r.ok);
  assert.equal(repo.getLead(db, lead.id)!.status, "in_progress");
  const tl = wf.listTimeline(db, lead.id);
  assert.equal(tl.length, 1);
  assert.deepEqual([tl[0].kind, tl[0].actorName, tl[0].from, tl[0].to], ["status", "Ольга Смирнова", "Новая", "В работе"]);
  const ob = wf.listOutbox(db, lead.id);
  assert.deepEqual([ob[0].kind, ob[0].payload, ob[0].status], ["status", "in_progress", "pending"]);
  assert.ok(changeStatus(db, olga, lead.id, "in_progress", T0).ok, "same status is a no-op");
  assert.equal(wf.listTimeline(db, lead.id).length, 1);
});

test("a manager cannot change, comment or reassign a colleague's lead; an admin can", () => {
  const db = testDb();
  const lead = website(db);
  assert.ok(assignLead(db, olga, lead.id, olga.id, T0).ok, "manager takes an unassigned lead");

  for (const r of [changeStatus(db, denis, lead.id, "won", T0), addComment(db, denis, lead.id, "hi", T0), assignLead(db, denis, lead.id, denis.id, T0)]) {
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "forbidden");
  }
  assert.equal(repo.getLead(db, lead.id)!.status, "new", "nothing changed");
  assert.equal(repo.getLead(db, lead.id)!.assigneeId, olga.id);
  assert.equal(wf.listTimeline(db, lead.id).length, 1, "only the successful assignment is in the history");

  assert.ok(changeStatus(db, admin, lead.id, "won", T0).ok);
  assert.ok(assignLead(db, admin, lead.id, denis.id, T0).ok);
  assert.ok(addComment(db, denis, lead.id, "now mine", T0).ok);
});

test("assignment rejects unknown or deactivated staff; invalid statuses and empty comments are refused", () => {
  const db = testDb();
  const lead = website(db);
  wf.setStaffActive(db, "staff-marina", false);
  assert.equal(assignLead(db, admin, lead.id, "staff-marina", T0).ok, false);
  assert.equal(assignLead(db, admin, lead.id, "nobody", T0).ok, false);
  assert.equal(changeStatus(db, admin, lead.id, "processed", T0).ok, false);
  assert.equal(addComment(db, admin, lead.id, "   ", T0).ok, false);
  assert.equal(addComment(db, admin, lead.id, "x".repeat(2001), T0).ok, false);
  assert.equal(changeStatus(db, admin, "missing", "won", T0).ok, false);
  assert.equal(wf.listTimeline(db, lead.id).length, 0);
});

test("comments appear in the history and are queued with the author's name", () => {
  const db = testDb();
  const lead = website(db);
  addComment(db, admin, lead.id, "  Позвонить завтра  ", T0);
  assert.equal(wf.listTimeline(db, lead.id)[0].body, "Позвонить завтра");
  assert.equal(wf.listOutbox(db, lead.id)[0].payload, "Администратор: Позвонить завтра");
});

test("manual leads: optional email, source, history entry, duplicate key and manager limits", () => {
  const db = testDb();
  const data = manualLeadSchema.parse({ name: "Звонок", phone: "8 900 111-22-33", email: "", serviceId: "support", comment: "по телефону", assigneeId: "staff-olga" });
  const r = createManualLead(db, admin, data, "mkey-aaaaaaaa", T0);
  assert.ok(r.ok && !r.value.duplicate);
  const lead = repo.getLead(db, r.ok ? r.value.lead.id : "")!;
  assert.deepEqual([lead.source, lead.email, lead.assigneeId, lead.phone], ["manual", "", "staff-olga", "+79001112233"]);
  assert.equal(wf.listTimeline(db, lead.id)[0].kind, "created");
  const again = createManualLead(db, admin, data, "mkey-aaaaaaaa", T0);
  assert.ok(again.ok && again.value.duplicate);
  assert.equal(repo.listLeads(db).length, 1);

  const forOther = createManualLead(db, olga, manualLeadSchema.parse({ ...data, assigneeId: "staff-denis" }), "mkey-bbbbbbbb", T0);
  assert.equal(!forOther.ok && forOther.code, "forbidden");
  assert.ok(createManualLead(db, olga, manualLeadSchema.parse({ ...data, assigneeId: "staff-olga" }), "mkey-cccccccc", T0).ok);
  assert.equal(manualLeadSchema.safeParse({ ...data, email: "not-an-email" }).success, false);
});

// ---- automation --------------------------------------------------------------------------------------------------

const rule = (config: AutomationRule["config"], enabled = true): Parameters<typeof wf.insertRule>[1] => ({ id: `r${++n}`, name: `Правило ${n}`, enabled, config, createdAt: T0.toISOString() });

test("by-service rule assigns, falls back, and records history, log and a Bitrix24 queue item", () => {
  const db = testDb();
  wf.insertRule(db, rule({ kind: "by_service", assignments: { "crm-integration": "staff-olga" }, fallbackStaffId: "staff-denis" }));
  const a = website(db, { serviceId: "crm-integration" });
  const b = website(db, { serviceId: "support" });
  assert.equal(applyAutomation(db, a.id, T0)?.staffId, "staff-olga");
  assert.equal(applyAutomation(db, b.id, T0)?.staffId, "staff-denis");

  assert.equal(repo.getLead(db, a.id)!.assigneeId, "staff-olga");
  const tl = wf.listTimeline(db, a.id);
  assert.deepEqual([tl[0].kind, tl[0].actorId, tl[0].actorName, tl[0].to], ["automation", undefined, "Автоматизация", "Ольга Смирнова"]);
  assert.equal(wf.listAutomationLog(db).filter((l) => l.leadId === a.id && l.ok).length, 1);
  assert.equal(wf.listOutbox(db, a.id)[0].kind, "assignee");
});

test("round robin rotates over active staff and persists its cursor", () => {
  const db = testDb();
  wf.insertRule(db, rule({ kind: "round_robin", staffIds: ["staff-olga", "staff-denis", "staff-marina"] }));
  wf.setStaffActive(db, "staff-denis", false);
  const order = [1, 2, 3, 4].map(() => applyAutomation(db, website(db).id, T0)?.staffId);
  assert.deepEqual(order, ["staff-olga", "staff-marina", "staff-olga", "staff-marina"]);
});

test("disabled rules do nothing, the first matching rule wins, and assigned leads are left alone", () => {
  const db = testDb();
  const off = rule({ kind: "by_service", assignments: { automation: "staff-denis" } }, false);
  const on = rule({ kind: "by_service", assignments: { automation: "staff-olga" } });
  wf.insertRule(db, off);
  const lead = website(db);
  assert.equal(applyAutomation(db, lead.id, T0), null);
  assert.equal(repo.getLead(db, lead.id)!.assigneeId, undefined);
  assert.equal(wf.listAutomationLog(db).length, 0, "no action, no log");

  wf.insertRule(db, on);
  assert.equal(applyAutomation(db, lead.id, T0)?.staffId, "staff-olga");

  const taken = website(db);
  assignLead(db, admin, taken.id, "staff-marina", T0);
  assert.equal(applyAutomation(db, taken.id, T0), null);
  assert.equal(repo.getLead(db, taken.id)!.assigneeId, "staff-marina");
});

test("a failed assignment leaves no history, no log success and no queue item", () => {
  const db = testDb();
  wf.insertRule(db, rule({ kind: "by_service", assignments: { automation: "staff-olga" } }));
  const lead = website(db);
  db.exec("DROP TABLE outbox"); // makes the last step of the transaction fail
  assert.equal(applyAutomation(db, lead.id, T0), null);
  assert.equal(repo.getLead(db, lead.id)!.assigneeId, undefined, "assignment rolled back");
  assert.equal(wf.listTimeline(db, lead.id).length, 0);
  const log = wf.listAutomationLog(db);
  assert.deepEqual(log.map((l) => l.ok), [false], "only the failure is recorded");
});

test("pickAssignee ignores unknown and inactive staff", () => {
  const staff = wf.listStaff(testDb());
  const r = { id: "r", name: "r", enabled: true, position: 1, createdAt: "", config: { kind: "round_robin", staffIds: ["ghost"] } } as AutomationRule;
  assert.equal(pickAssignee(r, { serviceId: "x" }, staff), null);
});

// ---- outbox: pushing changes to Bitrix24 ------------------------------------------------------------------------

test("changes wait until the lead exists in Bitrix24, then go out in order", async () => {
  const db = testDb();
  const lead = website(db);
  changeStatus(db, admin, lead.id, "in_progress", T0);
  assignLead(db, admin, lead.id, "staff-olga", T0);
  addComment(db, admin, lead.id, "привет", T0);

  const { client, calls } = spy();
  assert.equal(await processOutbox({ db, client, settings, now: () => T0 }), 0, "lead not synced yet: nothing sent");
  assert.deepEqual(calls, []);

  await synced(db, lead.id);
  assert.equal(await processOutbox({ db, client, settings, now: () => T0 }), 3);
  assert.deepEqual(calls, ['update 500 {"STATUS_ID":"IN_PROCESS"}', 'update 500 {"ASSIGNED_BY_ID":11}', "comment 500 Администратор: привет"]);
  assert.ok(wf.listOutbox(db, lead.id).every((o) => o.status === "done"));
  assert.equal(await processOutbox({ db, client, settings, now: () => T0 }), 0, "done items are not resent");
  assert.ok(repo.listEventsForLead(db, lead.id).some((e) => e.method === "crm.lead.update" && e.ok));
});

test("a failed push is kept with its error, retried for safe errors, and a person is needed for a bad setup", async () => {
  const db = testDb();
  const lead = website(db);
  await synced(db, lead.id);
  changeStatus(db, admin, lead.id, "won", T0);

  const down = spy({ fail: new BitrixError("лимит", "QUERY_LIMIT_EXCEEDED") });
  await processOutbox({ db, client: down.client, settings, now: () => T0 });
  let item = wf.listOutbox(db, lead.id)[0];
  assert.deepEqual([item.status, item.lastErrorCode, item.attempts], ["failed", "QUERY_LIMIT_EXCEEDED", 1]);
  assert.ok(item.nextRetryAt, "a retry is scheduled");
  assert.equal(repo.getLead(db, lead.id)!.status, "won", "the local change is never undone");

  assert.equal(await processOutbox({ db, client: down.client, settings, now: () => new Date(T0.getTime() + 10_000) }), 0, "not due yet");
  const ok = spy();
  assert.equal(await processOutbox({ db, client: ok.client, settings, now: () => new Date(T0.getTime() + 61_000) }), 1);
  item = wf.listOutbox(db, lead.id)[0];
  assert.deepEqual([item.status, item.attempts], ["done", 2]);

  assignLead(db, admin, lead.id, "staff-olga", T0);
  db.prepare("UPDATE staff SET bitrix_user_id = NULL WHERE id = 'staff-olga'").run();
  await processOutbox({ db, client: ok.client, settings, now: () => T0 });
  const bad = wf.listOutbox(db, lead.id)[0];
  assert.deepEqual([bad.status, bad.lastErrorCode, bad.nextRetryAt], ["failed", "NO_BITRIX_USER", undefined]);
});

test("a comment is not retried automatically after an ambiguous timeout, to avoid a duplicate", async () => {
  const db = testDb();
  const lead = website(db);
  await synced(db, lead.id);
  addComment(db, admin, lead.id, "важно", T0);
  await processOutbox({ db, client: spy({ fail: new BitrixError("нет ответа", "TIMEOUT") }).client, settings, now: () => T0 });
  const item = wf.listOutbox(db, lead.id)[0];
  assert.equal(item.status, "failed");
  assert.equal(item.nextRetryAt, undefined);
  const later = spy();
  assert.equal(await processOutbox({ db, client: later.client, settings, now: () => new Date(T0.getTime() + 7 * 86_400_000) }), 0, "the worker leaves it");
  const manual = await sendOutboxItem({ db, client: later.client, settings, now: () => T0 }, item.id);
  assert.ok(manual.sent, "a person can still resend it");
  assert.equal(later.calls.length, 1);
});

test("changes are never sent across demo and live: a demo lead ID means nothing on a real portal", async () => {
  const db = testDb();
  const lead = website(db);
  await synced(db, lead.id, true); // synced only to the demo client
  changeStatus(db, admin, lead.id, "won", T0);

  const live = spy({ demo: false });
  assert.equal(await processOutbox({ db, client: live.client, settings, now: () => T0 }), 0);
  assert.deepEqual(live.calls, []);
  const item = wf.listOutbox(db, lead.id)[0];
  const r = await sendOutboxItem({ db, client: live.client, settings, now: () => T0 }, item.id);
  assert.equal(r.sent, false);
  assert.match(!r.sent ? r.reason : "", /демо/);
  assert.equal(item.status, "pending");

  const demo = spy({ demo: true });
  assert.equal(await processOutbox({ db, client: demo.client, settings, now: () => T0 }), 1);
  assert.equal(wf.listOutbox(db, lead.id)[0].demo, true);
});

test("the demo seed gives a working database with staff, rules and assigned leads", () => {
  const db = openDatabase(":memory:", { adminPassword: "a", demoPassword: "d", now: T0 });
  assert.equal(wf.listStaff(db).length, 4);
  assert.equal(wf.listRules(db).length, 2);
  const q = repo.queryLeads(db, { pageSize: 100 });
  assert.equal(q.total, 40);
  assert.ok(q.rows.some((l) => l.assigneeId) && q.rows.some((l) => !l.assigneeId));
  assert.ok(q.rows.every((l) => ["new", "in_progress", "awaiting_reply", "won", "rejected"].includes(l.status)));
  assert.equal(wf.getCredentials(db, "OLGA@example.com")?.staff.role, "manager", "email lookup is case-insensitive");
});

test("without an admin password no account exists, so nobody can sign in", () => {
  const db = openDatabase(":memory:", { seed: false });
  assert.equal(wf.countStaff(db), 0);
});

// ---- first-start configuration -------------------------------------------------------------------------------------

import { accountConfig } from "./db";

test("development starts with demo accounts and data, production starts empty and closed", () => {
  const dev = accountConfig({ NODE_ENV: "development" });
  assert.deepEqual([dev.adminPassword, dev.demoPassword, dev.seedDemoData, dev.showDemoLogins], ["leadflow-demo", "leadflow-demo", true, true]);

  const prod = accountConfig({ NODE_ENV: "production" });
  assert.deepEqual([prod.adminPassword, prod.demoPassword, prod.seedDemoData, prod.showDemoLogins], [undefined, undefined, false, false], "no default passwords, no fictional data, nothing shown");

  const real = accountConfig({ NODE_ENV: "production", LEADFLOW_ADMIN_PASSWORD: "S3cret-admin-pass", LEADFLOW_DEMO_PASSWORD: "ignored", LEADFLOW_SHOW_DEMO_LOGINS: "true" });
  assert.deepEqual([real.adminPassword, real.demoPassword, real.seedDemoData, real.showDemoLogins], ["S3cret-admin-pass", undefined, false, false], "demo settings do nothing without LEADFLOW_DEMO=true");
});

test("a production demo stand needs an explicit opt-in, and never gets a default password", () => {
  const noPassword = accountConfig({ NODE_ENV: "production", LEADFLOW_DEMO: "true", LEADFLOW_ADMIN_PASSWORD: "a-long-admin-pass" });
  assert.deepEqual([noPassword.seedDemoData, noPassword.demoPassword, noPassword.showDemoLogins], [true, undefined, false]);

  const stand = accountConfig({ NODE_ENV: "production", LEADFLOW_DEMO: "true", LEADFLOW_DEMO_PASSWORD: "demo-pass-123", LEADFLOW_ADMIN_PASSWORD: "a-long-admin-pass" });
  assert.deepEqual([stand.seedDemoData, stand.demoPassword, stand.showDemoLogins], [true, "demo-pass-123", false], "logins are listed only with LEADFLOW_SHOW_DEMO_LOGINS=true");
  assert.equal(accountConfig({ NODE_ENV: "production", LEADFLOW_DEMO: "true", LEADFLOW_DEMO_PASSWORD: "demo-pass-123", LEADFLOW_SHOW_DEMO_LOGINS: "true" }).showDemoLogins, true);
});
