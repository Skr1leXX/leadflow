import assert from "node:assert/strict";
import { test } from "node:test";
import { BitrixError } from "./client";
import { RealBitrixClient } from "./real-client";

const SECRET = "s3cr3tc0de";
const URL_OK = `https://portal.example.com/rest/7/${SECRET}/`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const make = (fetchImpl: typeof fetch) => new RealBitrixClient({ webhookUrl: URL_OK, fetch: fetchImpl, timeoutMs: 50 });
const fields = {
  TITLE: "t", NAME: "n", PHONE: [], EMAIL: [], COMMENTS: "", SOURCE_ID: "WEB", SOURCE_DESCRIPTION: "s", STATUS_ID: "NEW", ASSIGNED_BY_ID: 1, ORIGINATOR_ID: "leadflow", ORIGIN_ID: "lead-1",
} as Parameters<RealBitrixClient["createLead"]>[0];

async function rejects(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof BitrixError, `expected BitrixError, got ${e}`);
    return e;
  }
  assert.fail("expected rejection");
}

test("rejects a malformed webhook URL without echoing it", () => {
  assert.throws(() => new RealBitrixClient({ webhookUrl: `http://x.example/${SECRET}` }), (e) => {
    assert.ok(e instanceof BitrixError);
    assert.equal(e.code, "BAD_WEBHOOK_URL");
    assert.ok(!e.message.includes(SECRET));
    return true;
  });
});

test("crm.lead.add posts JSON to the method URL and returns the ID", async () => {
  let seen: { url: string; body: unknown } | undefined;
  const c = make((async (url: string, init: RequestInit) => {
    seen = { url, body: JSON.parse(init.body as string) };
    return json({ result: 321 });
  }) as unknown as typeof fetch);
  assert.deepEqual(await c.createLead(fields), { id: 321 });
  assert.equal(seen?.url, `https://portal.example.com/rest/7/${SECRET}/crm.lead.add.json`);
  assert.deepEqual((seen?.body as { fields: unknown }).fields, fields);
});

test("a result that is not a lead ID is an error, not a success", async () => {
  const e = await rejects(make((async () => json({ result: true })) as unknown as typeof fetch).createLead(fields));
  assert.equal(e.code, "BAD_RESPONSE");
});

test("maps Bitrix24 error bodies and keeps the secret out of messages", async () => {
  const c = make((async () => json({ error: "INVALID_CREDENTIALS", error_description: SECRET }, 401)) as unknown as typeof fetch);
  const e = await rejects(c.createLead(fields));
  assert.equal(e.code, "INVALID_CREDENTIALS");
  assert.ok(!e.message.includes(SECRET));
});

test("rate limit and non-JSON responses", async () => {
  const limited = await rejects(make((async () => json({ error: "QUERY_LIMIT_EXCEEDED" }, 503)) as unknown as typeof fetch).createLead(fields));
  assert.equal(limited.code, "QUERY_LIMIT_EXCEEDED");
  const html = await rejects(make((async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch).createLead(fields));
  assert.equal(html.code, "HTTP_502");
});

test("timeout and unreachable portal", async () => {
  const hang = ((_: string, init: RequestInit) =>
    new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(init.signal?.reason)))) as unknown as typeof fetch;
  assert.equal((await rejects(make(hang).createLead(fields))).code, "TIMEOUT");

  const down = (async () => {
    throw new TypeError(`fetch failed ${URL_OK}`);
  }) as unknown as typeof fetch;
  const e = await rejects(make(down).createLead(fields));
  assert.equal(e.code, "PORTAL_UNREACHABLE");
  assert.ok(!e.message.includes(SECRET));
});

test("portal info combines profile, server.time and scope", async () => {
  const c = make((async (url: string) => {
    if (url.endsWith("/profile.json")) return json({ result: { NAME: "Иван", LAST_NAME: "Петров" } });
    if (url.endsWith("/server.time.json")) return json({ result: "2026-06-15T12:00:00+03:00" });
    return json({ result: ["crm", "user"] });
  }) as unknown as typeof fetch);
  const info = await c.getPortalInfo();
  assert.equal(info.portal, "portal.example.com");
  assert.equal(info.demo, false);
  assert.equal(info.user, "Иван Петров");
  assert.deepEqual(info.scopes, ["crm", "user"]);
});

test("a webhook without the crm scope fails the check", async () => {
  const c = make((async (url: string) => {
    if (url.endsWith("/scope.json")) return json({ result: ["user"] });
    return json({ result: url.endsWith("/profile.json") ? {} : "t" });
  }) as unknown as typeof fetch);
  assert.equal((await rejects(c.getPortalInfo())).code, "INSUFFICIENT_SCOPE");
});

test("crm.lead.update posts the lead ID and fields and needs a true confirmation", async () => {
  let seen: { url: string; body: { id: number; fields: unknown } } | undefined;
  const ok = make((async (url: string, init: RequestInit) => {
    seen = { url, body: JSON.parse(init.body as string) };
    return json({ result: true });
  }) as unknown as typeof fetch);
  await ok.updateLead(321, { STATUS_ID: "IN_PROCESS", ASSIGNED_BY_ID: 11 });
  assert.equal(seen?.url, `https://portal.example.com/rest/7/${SECRET}/crm.lead.update.json`);
  assert.equal(seen?.body.id, 321);
  assert.deepEqual(seen?.body.fields, { STATUS_ID: "IN_PROCESS", ASSIGNED_BY_ID: 11 });

  const unconfirmed = make((async () => json({ result: false })) as unknown as typeof fetch);
  assert.equal((await rejects(unconfirmed.updateLead(321, { STATUS_ID: "NEW" }))).code, "BAD_RESPONSE");
  const denied = make((async () => json({ error: "ACCESS_DENIED", error_description: "x" }, 403)) as unknown as typeof fetch);
  assert.equal((await rejects(denied.updateLead(321, { STATUS_ID: "NEW" }))).code, "ACCESS_DENIED");
});

test("crm.timeline.comment.add targets the lead and returns the comment ID", async () => {
  let body: { fields: Record<string, unknown> } | undefined;
  const c = make((async (_url: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return json({ result: 77 });
  }) as unknown as typeof fetch);
  assert.deepEqual(await c.addLeadComment(321, "Привет"), { id: 77 });
  assert.deepEqual(body?.fields, { ENTITY_ID: 321, ENTITY_TYPE: "lead", COMMENT: "Привет" });
  const bad = make((async () => json({ result: "nope" })) as unknown as typeof fetch);
  assert.equal((await rejects(bad.addLeadComment(321, "x"))).code, "BAD_RESPONSE");
});

test("findLeadByOrigin filters by originator and origin and parses the first ID", async () => {
  let body: { filter: unknown; select: unknown } | undefined;
  const hit = make((async (_u: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return json({ result: [{ ID: "555" }] });
  }) as unknown as typeof fetch);
  assert.equal(await hit.findLeadByOrigin("lead-1"), 555);
  assert.deepEqual(body, { filter: { ORIGINATOR_ID: "leadflow", ORIGIN_ID: "lead-1" }, select: ["ID"] });
  assert.equal(await make((async () => json({ result: [] })) as unknown as typeof fetch).findLeadByOrigin("lead-2"), null);
  assert.equal((await rejects(make((async () => json({ result: "x" })) as unknown as typeof fetch).findLeadByOrigin("l"))).code, "BAD_RESPONSE");
});
