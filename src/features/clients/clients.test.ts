import assert from "node:assert/strict";
import { test } from "node:test";
import type { Lead } from "../leads/types";
import { clientsFromLeads } from "./clients";

const lead = (id: string, over: Partial<Lead>): Lead => ({
  id, name: id, phone: "+79000000000", email: "", serviceId: "support", comment: "", status: "new", createdAt: "2026-06-01T10:00:00.000Z",
  source: "manual", demoData: false, sync: { status: "synced", attempts: 1, demo: false }, ...over,
});

test("leads are one client by e-mail, whatever the case", () => {
  const c = clientsFromLeads([lead("a", { email: "Ivan@Example.com" }), lead("b", { email: "ivan@example.com", createdAt: "2026-06-02T10:00:00.000Z", name: "Иван" })]);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].leadsCount, c[0].name, c[0].email], [2, "Иван", "ivan@example.com"]);
});

test("leads without an e-mail are told apart by phone and never merged into one nameless client", () => {
  const c = clientsFromLeads([
    lead("a", { phone: "+79001111111", name: "Звонок 1" }),
    lead("b", { phone: "+79002222222", name: "Звонок 2" }),
    lead("c", { phone: "+79001111111", name: "Звонок 1 снова", createdAt: "2026-06-02T10:00:00.000Z" }),
  ]);
  assert.equal(c.length, 2);
  assert.deepEqual(c.map((x) => [x.name, x.leadsCount]).sort(), [["Звонок 1 снова", 2], ["Звонок 2", 1]].sort());
  assert.ok(c.every((x) => x.email === ""));
});
