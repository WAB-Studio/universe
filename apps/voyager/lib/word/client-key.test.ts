// The address itself must never survive past this function — every
// assertion below reads the hash, never the header value it was built
// from.
import assert from "node:assert/strict";
import { test } from "node:test";

import { clientKey, clientKeyFromAddress } from "./client-key";

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/word/unlisted", { headers });
}

test("no salt configured means no key, whatever the caller sends", () => {
  assert.equal(clientKey(request({ "x-forwarded-for": "203.0.113.9" }), undefined), null);
});

test("no address at all means no key, salt or not", () => {
  assert.equal(clientKey(request({}), "a-real-salt-value"), null);
});

test("the same address and salt hash to the same key", () => {
  const a = clientKey(request({ "x-forwarded-for": "203.0.113.9" }), "a-real-salt-value");
  const b = clientKey(request({ "x-forwarded-for": "203.0.113.9" }), "a-real-salt-value");
  assert.ok(a);
  assert.equal(a, b);
});

test("a different address hashes to a different key", () => {
  const a = clientKey(request({ "x-forwarded-for": "203.0.113.9" }), "a-real-salt-value");
  const b = clientKey(request({ "x-forwarded-for": "203.0.113.10" }), "a-real-salt-value");
  assert.notEqual(a, b);
});

test("a different salt hashes the same address to a different key", () => {
  const a = clientKey(request({ "x-forwarded-for": "203.0.113.9" }), "salt-one-value");
  const b = clientKey(request({ "x-forwarded-for": "203.0.113.9" }), "salt-two-value");
  assert.notEqual(a, b);
});

test("the key is a hash, never the address it was built from", () => {
  const key = clientKey(request({ "x-forwarded-for": "203.0.113.9" }), "a-real-salt-value");
  assert.ok(key);
  assert.ok(!key.includes("203.0.113.9"));
});

test("x-forwarded-for's first hop is the address, the rest is the proxy chain", () => {
  const first = clientKey(request({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), "a-real-salt-value");
  const solo = clientKey(request({ "x-forwarded-for": "203.0.113.9" }), "a-real-salt-value");
  assert.equal(first, solo);
});

test("whitespace around the first hop does not change the key", () => {
  const padded = clientKey(request({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }), "a-real-salt-value");
  const bare = clientKey(request({ "x-forwarded-for": "203.0.113.9" }), "a-real-salt-value");
  assert.equal(padded, bare);
});

test("x-real-ip is the fallback when x-forwarded-for is absent", () => {
  const viaRealIp = clientKey(request({ "x-real-ip": "203.0.113.9" }), "a-real-salt-value");
  const viaForwardedFor = clientKey(request({ "x-forwarded-for": "203.0.113.9" }), "a-real-salt-value");
  assert.equal(viaRealIp, viaForwardedFor);
});

test("x-forwarded-for wins over x-real-ip when both are present", () => {
  const both = clientKey(
    request({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.10" }),
    "a-real-salt-value",
  );
  const forwardedOnly = clientKey(request({ "x-forwarded-for": "203.0.113.9" }), "a-real-salt-value");
  assert.equal(both, forwardedOnly);
});

// Every assertion above is relational — same in, same out; different in,
// different out — so all ten of them stay green if the algorithm or the
// order of concatenation changes. Measured 2026-09-20: sha256 to sha512
// with `address:salt` for `salt:address` passed 107/107, and
// `check-admission.ts` passed 17/17 too, because it derives the key it
// expects from this same function.
//
// The key is not an opaque value: it is the primary identity of a row in
// `reading.client_spend`. A formula that changes orphans every quota
// already banked and hands every device a fresh allowance, in silence.
// This pins the bytes, so changing them has to be a decision someone took
// on purpose rather than one a refactor took for them.
test("the formula itself is fixed, because banked quotas are keyed on it", () => {
  assert.equal(
    clientKeyFromAddress("203.0.113.7", "a-fixed-salt-for-this-test"),
    "694782ef69512ca7ba99a28e1e471529d5fd0a3702c18238bce72a3825b6ac31",
  );
});
