import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePhone, parseLeadInput } from "./schema";

test("normalizes phones", () => {
  assert.equal(normalizePhone("8 (900) 123-45-67"), "+79001234567");
  assert.equal(normalizePhone("+7 900 123 45 67"), "+79001234567");
  assert.equal(normalizePhone("123"), null);
});

test("returns per-field errors", () => {
  const r = parseLeadInput({ name: "A", phone: "1", email: "x", serviceId: "nope", comment: "" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ["email", "name", "phone", "serviceId"]);
});

test("accepts valid input and normalizes the phone", () => {
  const r = parseLeadInput({ name: "Анна", phone: "89001234567", email: "a@b.ru", serviceId: "automation", comment: "" });
  assert.equal(r.ok && r.data.phone, "+79001234567");
});
