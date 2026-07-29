import assert from "node:assert/strict";
import { test } from "node:test";
import { IntentReader } from "../src/intent-reader.js";

const silent = { info() {}, warn() {}, error() {} };

// Stands in for the model: returns whatever JSON the test wants to try.
function readerReturning(payload, { configured = true } = {}) {
  return new IntentReader({
    logger: silent,
    llm: {
      configured: () => configured,
      complete: async () => ({ content: typeof payload === "string" ? payload : JSON.stringify(payload) })
    }
  });
}

test("reads an order phrased the way people actually write", async () => {
  const reader = readerReturning({ action: "buy", asset: "cash cat", amount_usd: 1.5, refers_to_context: false });
  const intent = await reader.read("@bot grab me a buck fifty of cash cat", "bot");
  assert.equal(intent.wantsBuy, true);
  assert.equal(intent.amountUsd, 1.5);
  assert.equal(intent.term, "CASHCAT");
});

test("a question is never an order, whatever the model says", async () => {
  const reader = readerReturning({ action: "none", asset: "NVDA", amount_usd: 50, refers_to_context: false });
  assert.equal(await reader.read("@bot would you buy $50 of NVDA here?", "bot"), null);
});

test("an asset the sender never mentioned is refused", async () => {
  // The defence that matters: a model slip, or an instruction smuggled into a
  // quoted tweet, must not be able to name its own token.
  const reader = readerReturning({ action: "buy", asset: "SCAMCOIN", amount_usd: 20, refers_to_context: false });
  const intent = await reader.read("@bot buy me $20 of pepe", "bot");
  assert.equal(intent.term, "PEPE");
});

test("an asset from the conversation is allowed through", async () => {
  const reader = readerReturning({ action: "buy", asset: "NVDA", amount_usd: 20, refers_to_context: true });
  const intent = await reader.read("@bot buy it, 20 bucks", "bot", { contextText: "NVDA looks strong" });
  assert.equal(intent.term, "NVDA");
});

test("absurd amounts fall back to what was actually written", async () => {
  const reader = readerReturning({ action: "buy", asset: "PEPE", amount_usd: 99999999999, refers_to_context: false });
  const intent = await reader.read("@bot buy $20 of pepe", "bot");
  assert.equal(intent.amountUsd, 20);
});

test("a model outage still lets people trade", async () => {
  const reader = new IntentReader({
    logger: silent,
    llm: { configured: () => true, complete: async () => { throw new Error("502"); } }
  });
  const intent = await reader.read("@bot buy $20 of pepe", "bot");
  assert.equal(intent.wantsBuy, true);
  assert.equal(intent.amountUsd, 20);
  assert.equal(intent.term, "PEPE");
});

test("prose around the JSON does not break it", async () => {
  const reader = readerReturning('Sure! ```json\n{"action":"buy","asset":"PEPE","amount_usd":5}\n```');
  const intent = await reader.read("@bot ape 5 dollars into pepe", "bot");
  assert.equal(intent.term, "PEPE");
  assert.equal(intent.amountUsd, 5);
});

test("without a model the patterns still run", async () => {
  const reader = readerReturning({}, { configured: false });
  const intent = await reader.read("@bot buy $20 of pepe", "bot");
  assert.equal(intent.term, "PEPE");
});

test("a sell request is recognized and routed away from buying", async () => {
  const reader = readerReturning({ action: "sell", asset: "PEPE", amount_usd: null, refers_to_context: false });
  const intent = await reader.read("@bot dump my pepe", "bot");
  assert.equal(intent.wantsSell, true);
  assert.equal(intent.wantsBuy, false);
});

test("a company name resolves to its ticker", async () => {
  // "tesla" never contains the literal string "TSLA", but every letter is
  // there in order, so the ticker is derived rather than invented.
  const reader = readerReturning({ action: "buy", asset: "TSLA", amount_usd: 5, refers_to_context: false });
  const intent = await reader.read("@bot get me 5 dollars of tesla stock", "bot");
  assert.equal(intent.term, "TSLA");
});

test("an unrelated ticker is still refused", async () => {
  const reader = readerReturning({ action: "buy", asset: "XYZQ", amount_usd: 5, refers_to_context: false });
  const intent = await reader.read("@bot buy 5 dollars of tesla stock", "bot");
  assert.notEqual(intent.term, "XYZQ");
});

test("a well-known company name yields its ticker", async () => {
  // "apple" and "AAPL" share almost no letters, so this cannot come from the
  // letter check; the name itself is what vouches for the ticker.
  const reader = readerReturning({ action: "buy", asset: "AAPL", amount_usd: 5, refers_to_context: false });
  const intent = await reader.read("@bot buy 5 dollars worth of apple", "bot");
  assert.equal(intent.term, "AAPL");
});

test("a company name does not license an unrelated ticker", async () => {
  const reader = readerReturning({ action: "buy", asset: "SCAMX", amount_usd: 5, refers_to_context: false });
  const intent = await reader.read("@bot buy 5 dollars worth of apple", "bot");
  assert.equal(intent.term, "AAPL");
});

test("claiming the asset came from context does not excuse inventing one", async () => {
  // Asked to buy $VIRTUAL, the model answered SOLANA with refers_to_context
  // set, and the flag alone waved it through.
  const reader = readerReturning({ action: "buy", asset: "SOLANA", amount_usd: 1, refers_to_context: true });
  const intent = await reader.read("@bot i want you to buy 1 dollar of $VIRTUAL", "bot");
  assert.equal(intent.term, "VIRTUAL");
});

test("an asset genuinely from the context is still allowed", async () => {
  const reader = readerReturning({ action: "buy", asset: "NVDA", amount_usd: 20, refers_to_context: true });
  const intent = await reader.read("@bot buy it, 20 bucks", "bot", { contextText: "NVDA looks strong here" });
  assert.equal(intent.term, "NVDA");
});

test("a sell cannot invent its asset either", async () => {
  const reader = readerReturning({ action: "sell", asset: "SOLANA", portion: 1, refers_to_context: true });
  const intent = await reader.read("@bot sell my VIRTUAL", "bot");
  assert.equal(intent.wantsSell, true);
  assert.notEqual(intent.term, "SOLANA");
});

test("what the person typed outranks anything in the thread", async () => {
  // The bot's own earlier reply had mentioned solana, so with the thread as
  // context the model answered SOLANA to a message that plainly says $VIRTUAL.
  const reader = readerReturning({ action: "buy", asset: "SOLANA", amount_usd: 1, refers_to_context: true });
  const intent = await reader.read("@bot i want you to buy $ 1 of $VIRTUAL", "bot", {
    contextText: "dropping a contract address like that and the token's on solana with $842M FDV"
  });
  assert.equal(intent.term, "VIRTUAL");
});

test("context still answers a message that names nothing", async () => {
  const reader = readerReturning({ action: "buy", asset: "CASHCAT", amount_usd: 10, refers_to_context: true });
  const intent = await reader.read("@bot buy it, $10", "bot", { contextText: "cashcat looks ready here" });
  assert.equal(intent.term, "CASHCAT");
});
