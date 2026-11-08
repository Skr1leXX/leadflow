import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "@/features/leads/db";
import { insertLead } from "@/features/leads/repo";
import type { Lead } from "@/features/leads/types";
import { buildDashboard, computeAnalytics, resolveRange } from "./analytics";

const TODAY = "2026-06-15";
const NOW = new Date("2026-06-15T12:00:00+03:00");

test("presets end today and cover the right number of days", () => {
  assert.deepEqual(resolveRange({ period: "week" }, TODAY).range, { from: "2026-06-09", to: TODAY, days: 7 });
  assert.deepEqual(resolveRange({ period: "month" }, TODAY).range, { from: "2026-05-17", to: TODAY, days: 30 });
  assert.deepEqual(resolveRange({ period: "quarter" }, TODAY).range, { from: "2026-03-18", to: TODAY, days: 90 });
  assert.equal(resolveRange({}, TODAY).period, "month", "no choice means the last month");
  assert.equal(resolveRange({ period: "nonsense" }, TODAY).period, "month");
});

test("custom periods are validated and fall back with an explanation", () => {
  const ok = resolveRange({ period: "custom", from: "2026-06-01", to: "2026-06-10" }, TODAY);
  assert.deepEqual([ok.period, ok.range.days, ok.note], ["custom", 10, undefined]);
  assert.equal(resolveRange({ period: "custom", from: "2026-06-01", to: "2026-06-01" }, TODAY).range.days, 1);

  for (const bad of [{ from: "2026-06-10", to: "2026-06-01" }, { from: "", to: "2026-06-01" }, { from: "2026-02-30", to: "2026-03-01" }, { from: "2024-01-01", to: "2026-06-01" }, { from: "x", to: "y" }]) {
    const r = resolveRange({ period: "custom", ...bad }, TODAY);
    assert.equal(r.period, "month");
    assert.ok(r.note, `explains why: ${JSON.stringify(bad)}`);
  }
});

const row = (createdAt: string, status: Lead["status"] = "new", source = "website", serviceId = "automation", demoData = false) => ({ createdAt, status, source, serviceId, demoData });

test("counts, conversion, distributions and the daily series come from the rows", () => {
  const range = { from: "2026-06-13", to: "2026-06-15", days: 3 };
  const a = computeAnalytics(
    [
      row("2026-06-13T09:00:00+03:00", "won", "website", "automation"),
      row("2026-06-13T10:00:00+03:00", "new", "manual", "support"),
      row("2026-06-15T23:30:00+03:00", "rejected", "website", "automation"),
      row("2026-06-15T01:00:00+03:00", "in_progress", "website", "analytics", true),
    ],
    range,
  );
  assert.equal(a.total, 4);
  assert.deepEqual(a.byStatus, { new: 1, in_progress: 1, awaiting_reply: 0, won: 1, rejected: 1 });
  assert.equal(a.conversion, 25);
  assert.deepEqual(a.series.map((p) => p.leads), [2, 0, 2], "days are Moscow days, empty days are zero");
  assert.deepEqual(a.sources, [{ key: "website", count: 3 }, { key: "manual", count: 1 }]);
  assert.deepEqual(a.services[0], { key: "automation", count: 2 });
  assert.equal(a.demoCount, 1);
});

test("an empty period gives zeros, not NaN", () => {
  const a = computeAnalytics([], { from: "2026-06-15", to: "2026-06-15", days: 1 });
  assert.deepEqual([a.total, a.conversion, a.sources.length, a.series.length], [0, 0, 0, 1]);
});

const lead = (id: string, createdAt: string, over: Partial<Lead> = {}): Lead => ({
  id, name: id, phone: "+79000000000", email: `${id}@example.com`, serviceId: "automation", comment: "", status: "new", createdAt: new Date(createdAt).toISOString(), // the app always stores UTC ISO strings
  source: "website", demoData: false, sync: { status: "synced", attempts: 1, demo: false }, ...over,
});

test("the dashboard reads the database: period bounds, previous-period change and demo filtering", async () => {
  const db = await openDatabase("file::memory:", { seed: false });
  // Period: the 7 days 09..15 June. Previous period: 02..08 June.
  await insertLead(db, lead("in-first-day", "2026-06-09T00:00:00+03:00", { status: "won" }));
  await insertLead(db, lead("in-last-day", "2026-06-15T23:59:59+03:00"));
  await insertLead(db, lead("before", "2026-06-08T23:59:59+03:00"));
  await insertLead(db, lead("prev-2", "2026-06-02T00:00:00+03:00"));
  await insertLead(db, lead("too-old", "2026-06-01T23:59:59+03:00"));
  await insertLead(db, lead("lead-001", "2026-06-12T10:00:00+03:00", { demoData: true, status: "rejected" }));

  const withDemo = await buildDashboard(db, { period: "week", includeDemo: true }, NOW);
  assert.equal(withDemo.total, 3, "first and last day are inside, the day before is not");
  assert.equal(withDemo.demoCount, 1);
  assert.equal(withDemo.previousTotal, 2);
  assert.equal(withDemo.delta, 50);

  const real = await buildDashboard(db, { period: "week", includeDemo: false }, NOW);
  assert.equal(real.total, 2);
  assert.equal(real.demoInPeriod, 1, "says how many demo leads are being hidden");
  assert.equal(real.byStatus.rejected, 0);
  assert.equal(real.conversion, 50);

  const custom = await buildDashboard(db, { period: "custom", from: "2026-06-02", to: "2026-06-02", includeDemo: true }, NOW);
  assert.deepEqual([custom.total, custom.series.length, custom.previousTotal], [1, 1, 1], "the previous period of a single day is the day before");
  assert.equal(custom.delta, 0);

  const empty = await buildDashboard(db, { period: "custom", from: "2026-05-01", to: "2026-05-01", includeDemo: true }, NOW);
  assert.deepEqual([empty.total, empty.previousTotal, empty.delta], [0, 0, null], "no previous leads, no percentage");
});
