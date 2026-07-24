import test from "node:test";
import assert from "node:assert/strict";
import { MentionWorker } from "../src/mention-worker.js";

function worker(user) {
  return new MentionWorker({
    store: { getUser: async () => user },
    client: {},
    bot: { botUsername: "xbot" },
    publicBaseUrl: "https://xbot.example"
  });
}

test("returns a public portfolio link only for opted-in users", async () => {
  const reply = await worker({
    publicSharing: true,
    portfolio: { hideValues: false, totalValueUsd: 1234, holdings: [{ symbol: "BTC" }] }
  }).commandReply("@xbot portfolio", "alice");

  assert.match(reply, /@alice BTC · \$1,234/);
  assert.match(reply, /https:\/\/xbot\.example\/p\/xbot\/alice/);
});

test("never turns a public post into an order", async () => {
  assert.match(await worker(null).commandReply("@xbot buy BTC", "alice"), /never execute trades/);
});
