import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSecrets } from "./redact";

const env = { BITRIX24_WEBHOOK_URL: "https://p.bitrix24.ru/rest/1/abc123SECRETxyz/", LEADFLOW_API_TOKEN: "api-token-value-1" };

test("webhook access codes are masked inside URLs and when echoed alone", () => {
  assert.equal(redactSecrets("fetch failed https://p.bitrix24.ru/rest/7/q1w2e3r4t5y6/crm.lead.add.json", {}), "fetch failed https://p.bitrix24.ru/rest/7/***/crm.lead.add.json");
  assert.equal(redactSecrets("bad code abc123SECRETxyz here", env), "bad code *** here");
});

test("bearer tokens and key=value credentials are masked", () => {
  assert.equal(redactSecrets("Authorization: Bearer abcDEF123456", {}), "Authorization: Bearer ***");
  assert.equal(redactSecrets("failed: password=hunter2 token: abcdef123 api_key=XYZ789", {}), "failed: password=*** token: *** api_key=***");
  assert.equal(redactSecrets('{"access_token":"abcdef12345"}', {}), '{"access_token":"***"}');
});

test("configured secrets are removed wherever they appear, ordinary text is untouched", () => {
  assert.equal(redactSecrets("token api-token-value-1 leaked", env), "token *** leaked");
  const plain = "Портал не ответил за 10 с (QUERY_LIMIT_EXCEEDED)";
  assert.equal(redactSecrets(plain, env), plain);
});
