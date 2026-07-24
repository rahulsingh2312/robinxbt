import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fitForPost, mintAgentJwt } from "../src/insiders.js";
import { MentionWorker } from "../src/mention-worker.js";
import { RiskLimits } from "../src/trading.js";

test("mints a JWT the agent can verify", () => {
  const token = mintAgentJwt("user-123", "secret");
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  assert.equal(JSON.parse(Buffer.from(payload, "base64url").toString()).userId, "user-123");
  const expected = createHmac("sha256", "secret").update(`${header}.${payload}`).digest("base64url");
  assert.equal(signature, expected);
});

test("keeps replies inside the X character limit", () => {
  assert.equal(fitForPost("short answer"), "short answer");
  const long = `${"word ".repeat(200)}`;
  assert.ok(fitForPost(long).length <= 275);
  const sentences = `${"a".repeat(200)}. ${"b".repeat(200)}.`;
  assert.ok(fitForPost(sentences).endsWith("."), "should trim at a sentence boundary");
});

function basketWorker({ placed = [], agentText, authorized = "999", basket = null } = {}) {
  const saved = {};
  const worker = new MentionWorker({
    store: {
      getUser: async () => null,
      claimMention: async () => true,
      claimOrder: async () => true,
      getSpend: async () => 0,
      recordSpend: async () => {},
      savePendingBasket: async (bot, id, value) => { saved[id] = value; },
      getPendingBasket: async () => basket,
      clearPendingBasket: async () => {}
    },
    client: { reply: async () => ({ data: { id: "reply-1" } }) },
    bot: { botUsername: "xbot", dryRun: false },
    logger: { info() {}, warn() {}, error() {} },
    broker: { placeOrder: async (o) => { placed.push(o); return { text: "Filled" }; }, call: async () => ({}) },
    limits: new RiskLimits({ allowedAuthorIds: [authorized], maxOrderUsd: 100, dailyMaxUsd: 500 }),
    insiders: { configured: () => true, ask: async () => ({ text: agentText }) }
  });
  worker.saved = saved;
  return worker;
}

test("proposes a basket to an authorized asker and stores it against the reply", async () => {
  const worker = basketWorker({ agentText: "Semis look strong. I like $NVDA and $AMD here." });
  await worker.handleMention({ id: "1", author_id: "999", username: "alice", text: "@xbot my thesis is AI infra is underpriced" });
  assert.deepEqual(worker.saved["reply-1"].symbols, ["NVDA", "AMD"]);
  assert.equal(worker.saved["reply-1"].perSymbolUsd, 50);
});

test("gives an unauthorized asker analysis but no buy option", async () => {
  const worker = basketWorker({ agentText: "I like $NVDA here.", authorized: "999" });
  const reply = await worker.commandReply("@xbot what should i buy", "mallory", { id: "1", author_id: "666" });
  assert.doesNotMatch(reply, /CONFIRM/);
  assert.deepEqual(worker.saved, {});
});

test("a confirm reply buys the stored basket", async () => {
  const placed = [];
  const worker = basketWorker({ placed, basket: { symbols: ["NVDA", "AMD"], perSymbolUsd: 50, authorId: "999" } });
  const reply = await worker.commandReply("confirm", "alice", {
    id: "2", author_id: "999", text: "confirm", referenced_tweets: [{ type: "replied_to", id: "reply-1" }]
  });
  assert.deepEqual(placed, [
    { side: "buy", symbol: "NVDA", notionalUsd: 50, userId: "999" },
    { side: "buy", symbol: "AMD", notionalUsd: 50, userId: "999" }
  ]);
  assert.match(reply, /Bought \$50 each of NVDA, AMD/);
});

test("someone else cannot confirm your basket", async () => {
  const placed = [];
  const worker = basketWorker({ placed, basket: { symbols: ["NVDA"], perSymbolUsd: 50, authorId: "999" } });
  const reply = await worker.commandReply("confirm", "mallory", {
    id: "2", author_id: "666", text: "confirm", referenced_tweets: [{ type: "replied_to", id: "reply-1" }]
  });
  assert.match(reply, /Only the person who asked/);
  assert.deepEqual(placed, []);
});
