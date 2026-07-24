import test from "node:test";
import assert from "node:assert/strict";
import { PaperBroker, describeBook } from "../src/paper-broker.js";
import { Store } from "../src/store.js";
import { MentionWorker } from "../src/mention-worker.js";

function memoryStore() {
  const store = new Store("/dev/null");
  store.save = async () => {}; // keep it in memory
  return store;
}

const quoteSource = {
  call: async (kind, { symbol }) => ({ structured: { symbol, price: 100 } })
};

test("paper buys accumulate a per-user book priced from live quotes", async () => {
  const store = memoryStore();
  const broker = new PaperBroker({ store, botUsername: "xbot", quoteSource, logger: { warn() {} } });
  await broker.placeOrder({ side: "buy", symbol: "NVDA", notionalUsd: 50, userId: "42" });
  await broker.placeOrder({ side: "buy", symbol: "NVDA", notionalUsd: 25, userId: "42" });
  await broker.placeOrder({ side: "buy", symbol: "AMD", quantity: 2, userId: "42" });

  const book = await store.getPaperBook("xbot", "42");
  assert.equal(book.positions.NVDA.investedUsd, 75);
  assert.equal(book.positions.NVDA.shares, 0.75);
  assert.equal(book.positions.AMD.investedUsd, 200);
  assert.equal(describeBook(book), "Paper book: $AMD $200 · $NVDA $75 — $275 in.");
});

test("paper books are isolated per user", async () => {
  const store = memoryStore();
  const broker = new PaperBroker({ store, botUsername: "xbot", quoteSource, logger: { warn() {} } });
  await broker.placeOrder({ side: "buy", symbol: "NVDA", notionalUsd: 50, userId: "42" });
  assert.equal(await store.getPaperBook("xbot", "77"), null);
});

test("a sell reduces the position", async () => {
  const store = memoryStore();
  const broker = new PaperBroker({ store, botUsername: "xbot", quoteSource, logger: { warn() {} } });
  await broker.placeOrder({ side: "buy", symbol: "NVDA", notionalUsd: 100, userId: "42" });
  await broker.placeOrder({ side: "sell", symbol: "NVDA", notionalUsd: 40, userId: "42" });
  const book = await store.getPaperBook("xbot", "42");
  assert.equal(book.positions.NVDA.investedUsd, 60);
});

test("unpriced notional buys still fill; unpriced quantity buys throw", async () => {
  const store = memoryStore();
  const broker = new PaperBroker({ store, botUsername: "xbot", quoteSource: null, logger: { warn() {} } });
  await broker.placeOrder({ side: "buy", symbol: "NVDA", notionalUsd: 50, userId: "42" });
  const book = await store.getPaperBook("xbot", "42");
  assert.equal(book.positions.NVDA.investedUsd, 50);
  assert.equal(book.positions.NVDA.shares, null);
  await assert.rejects(broker.placeOrder({ side: "buy", symbol: "NVDA", quantity: 3, userId: "42" }), /Cannot price/);
});

test("the same mention delivered twice is handled once", async () => {
  const store = memoryStore();
  const replies = [];
  const worker = new MentionWorker({
    store,
    client: { reply: async (id, text) => { replies.push(text); return { data: { id: "r1" } }; } },
    bot: { botUsername: "xbot", dryRun: false },
    logger: { info() {}, warn() {}, error() {} }
  });
  const post = { id: "555", author_id: "42", username: "alice", text: "@xbot hello" };
  await worker.handleMention(post); // stream delivery
  await worker.handleMention(post); // poll delivery 4s later
  assert.equal(replies.length, 1);
});

test("portfolio ask returns the paper book", async () => {
  const store = memoryStore();
  const broker = new PaperBroker({ store, botUsername: "xbot", quoteSource, logger: { warn() {} } });
  await broker.placeOrder({ side: "buy", symbol: "NVDA", notionalUsd: 50, userId: "42" });
  const worker = new MentionWorker({
    store,
    client: {},
    bot: { botUsername: "xbot", dryRun: true },
    logger: { info() {}, warn() {}, error() {} }
  });
  const reply = await worker.commandReply("@xbot portfolio", "alice", { id: "9", author_id: "42" });
  assert.equal(reply, "Paper book: $NVDA $50 — $50 in.");
});
