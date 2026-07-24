import test from "node:test";
import assert from "node:assert/strict";
import { parseOrder, RiskLimits } from "../src/trading.js";
import { MentionWorker } from "../src/mention-worker.js";

test("parses share and dollar orders", () => {
  assert.deepEqual(parseOrder("@xbot buy 5 AAPL", "xbot"), { side: "buy", symbol: "AAPL", quantity: 5 });
  assert.deepEqual(parseOrder("@xbot sell 2 shares of TSLA", "xbot"), { side: "sell", symbol: "TSLA", quantity: 2 });
  assert.deepEqual(parseOrder("@xbot buy $500 of NVDA", "xbot"), { side: "buy", symbol: "NVDA", notionalUsd: 500 });
  assert.deepEqual(parseOrder("@xbot buy $1,250.50 worth of MSFT", "xbot"), { side: "buy", symbol: "MSFT", notionalUsd: 1250.5 });
});

test("refuses to guess when quantity is missing", () => {
  // With instant execution a wrong guess is an unrecoverable real order.
  assert.equal(parseOrder("@xbot buy AAPL", "xbot"), null);
  assert.equal(parseOrder("@xbot what do you think of AAPL", "xbot"), null);
  assert.equal(parseOrder("@xbot buy 0 AAPL", "xbot"), null);
});

test("blocks orders over the per-order and daily caps", () => {
  const limits = new RiskLimits({ allowedAuthorIds: ["1"], maxOrderUsd: 100, dailyMaxUsd: 250 });
  const order = { side: "buy", symbol: "AAPL", notionalUsd: 150 };
  assert.match(limits.check(order, { spentTodayUsd: 0 }).reason, /per-order cap/);

  const small = { side: "buy", symbol: "AAPL", notionalUsd: 90 };
  assert.equal(limits.check(small, { spentTodayUsd: 0 }).ok, true);
  assert.match(limits.check(small, { spentTodayUsd: 200 }).reason, /daily cap/);
});

test("refuses a buy it cannot price", () => {
  const limits = new RiskLimits({ allowedAuthorIds: ["1"], maxOrderUsd: 100, dailyMaxUsd: 250 });
  const verdict = limits.check({ side: "buy", symbol: "AAPL", quantity: 3 }, { spentTodayUsd: 0, estimatedUsd: undefined });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /could not price/);
});

test("authorizes by author ID, not handle", () => {
  const limits = new RiskLimits({ allowedAuthorIds: ["12345"], maxOrderUsd: 100, dailyMaxUsd: 250 });
  assert.equal(limits.authorizes("12345"), true);
  assert.equal(limits.authorizes("99999"), false);
});

function tradingWorker({ placed = [], claim = true, spend = 0 } = {}) {
  return new MentionWorker({
    store: {
      getUser: async () => null,
      claimOrder: async () => claim,
      getSpend: async () => spend,
      recordSpend: async () => {}
    },
    client: {},
    bot: { botUsername: "xbot", dryRun: false },
    logger: { info() {}, warn() {}, error() {} },
    broker: {
      placeOrder: async (order) => { placed.push(order); return { text: "Filled" }; },
      call: async () => ({ structured: { price: 10 }, text: "" })
    },
    limits: new RiskLimits({ allowedAuthorIds: ["999"], maxOrderUsd: 100, dailyMaxUsd: 500 })
  });
}

test("an unauthorized author never reaches the broker", async () => {
  const placed = [];
  const reply = await tradingWorker({ placed }).commandReply("@xbot buy 5 AAPL", "mallory", { id: "1", author_id: "666" });
  assert.match(reply, /not authorized/);
  assert.deepEqual(placed, []);
});

test("an authorized author gets a real fill", async () => {
  const placed = [];
  const reply = await tradingWorker({ placed }).commandReply("@xbot buy 5 AAPL", "alice", { id: "1", author_id: "999" });
  assert.match(reply, /bought 5 AAPL/);
  assert.deepEqual(placed, [{ side: "buy", symbol: "AAPL", quantity: 5, userId: "999" }]);
});

test("an already-claimed mention is never traded twice", async () => {
  const placed = [];
  const reply = await tradingWorker({ placed, claim: false }).commandReply("@xbot buy 5 AAPL", "alice", { id: "1", author_id: "999" });
  assert.equal(reply, null);
  assert.deepEqual(placed, []);
});
