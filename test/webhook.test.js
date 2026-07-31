import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { crcResponse, extractMentions, verifySignature } from "../src/webhook.js";

const SECRET = "test-consumer-secret";

test("answers the CRC challenge with an HMAC-SHA256 of the token", () => {
  const { response_token: token } = crcResponse("abc123", SECRET);
  const expected = createHmac("sha256", SECRET).update("abc123").digest("base64");
  assert.equal(token, `sha256=${expected}`);
});

test("rejects an event that is not signed by X", () => {
  const body = JSON.stringify({ hello: "world" });
  const valid = `sha256=${createHmac("sha256", SECRET).update(body).digest("base64")}`;
  assert.equal(verifySignature(body, valid, SECRET), true);
  assert.equal(verifySignature(body, "sha256=forged", SECRET), false);
  assert.equal(verifySignature(body, undefined, SECRET), false);
  // A tampered body must invalidate an otherwise-valid signature.
  assert.equal(verifySignature(JSON.stringify({ hello: "evil" }), valid, SECRET), false);
});

test("extracts mentions from a v2-style envelope", () => {
  const mentions = extractMentions({
    data: [{ id: "1", text: "@bot buy 5 AAPL", author_id: "42" }],
    includes: { users: [{ id: "42", username: "alice" }] }
  });
  assert.deepEqual(mentions, [{ id: "1", text: "@bot buy 5 AAPL", author_id: "42", username: "alice" }]);
});

test("extracts mentions from a v1-style envelope", () => {
  const mentions = extractMentions({
    tweet_create_events: [{ id_str: "9", text: "@bot portfolio", user: { id_str: "42", screen_name: "alice" } }]
  });
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].id, "9");
  assert.equal(mentions[0].username, "alice");
});

test("returns nothing for an unrecognized payload instead of throwing", () => {
  assert.deepEqual(extractMentions({ favorite_events: [{}] }), []);
  assert.deepEqual(extractMentions(null), []);
});

test("a 429 waits for X to release the old connection", async () => {
  // Reconnecting immediately guarantees another 429, which is what turned a
  // single dropped stream into a loop of them.
  const { MentionStream } = await import("../src/stream.js");
  const stream = new MentionStream({ bearerToken: "t", worker: {}, logger: { info() {}, warn() {}, error() {} } });
  stream.backoffMs = 1_000;
  stream.consume = async () => { throw new Error('stream 429: {"title":"ConnectionException","detail":"maximum allowed connection limit"}'); };
  const waits = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { waits.push(ms); stream.stopped = true; return realSetTimeout(fn, 0); };
  await stream.run();
  globalThis.setTimeout = realSetTimeout;
  assert.ok(waits[0] >= 60_000, `waited ${waits[0]}ms after a 429`);
});
