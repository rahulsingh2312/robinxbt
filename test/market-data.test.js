import assert from "node:assert/strict";
import { test } from "node:test";
import { MarketData } from "../src/market-data.js";

const silent = { info() {}, warn() {}, error() {} };

function jsonResponse(body) {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
}

test("stock quote via yahoo includes price and day change", async () => {
  const data = new MarketData({
    logger: silent,
    fetcher: async () => jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 130.5, chartPreviousClose: 125 } }] } })
  });
  const quote = await data.call("quote", { symbol: "NVDA" });
  assert.equal(quote.structured.price, 130.5);
  assert.ok(Math.abs(quote.structured.changePercent - 4.4) < 0.01);
  assert.match(quote.text, /NVDA \$130\.5 \(\+4\.40% today\)/);
});

test("falls back to stooq when yahoo fails", async () => {
  const data = new MarketData({
    logger: silent,
    fetcher: async (url) => String(url).includes("yahoo")
      ? { ok: false, status: 429 }
      : { ok: true, text: async () => "Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-07-27,22:00:00,210,215,209,214.5,1000000" }
  });
  const quote = await data.callByName("get_quote", { symbol: "aapl" });
  assert.equal(quote.structured.price, 214.5);
  assert.equal(quote.structured.source, "stooq");
});

test("crypto symbols route to coingecko with 24h change", async () => {
  const data = new MarketData({
    logger: silent,
    fetcher: async () => jsonResponse({ dogecoin: { usd: 0.123456, usd_24h_change: -5.4321 } })
  });
  const quote = await data.call("quote", { symbol: "$DOGE" });
  assert.equal(quote.structured.price, 0.123456);
  assert.match(quote.text, /DOGE \$0\.123456 \(-5\.43% 24h\)/);
});

test("crypto falls back to coinbase spot without change", async () => {
  const data = new MarketData({
    logger: silent,
    fetcher: async (url) => String(url).includes("coingecko")
      ? { ok: false, status: 429 }
      : jsonResponse({ data: { amount: "64123.45" } })
  });
  const quote = await data.call("quote", { symbol: "BTC" });
  assert.equal(quote.structured.price, 64123.45);
  assert.equal(quote.structured.changePercent, null);
});

test("caches quotes within the TTL", async () => {
  let fetches = 0;
  const data = new MarketData({
    logger: silent,
    fetcher: async () => { fetches += 1; return jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 10, chartPreviousClose: 10 } }] } }); }
  });
  await data.call("quote", { symbol: "SPY" });
  await data.call("quote", { symbol: "SPY" });
  assert.equal(fetches, 1);
});

test("rejects garbage symbols and unknown tools", async () => {
  const data = new MarketData({ logger: silent, fetcher: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(() => data.call("quote", { symbol: "DROP TABLE" }));
  await assert.rejects(() => data.call("positions", {}));
  await assert.rejects(() => data.callByName("place_order", { symbol: "NVDA" }));
});

test("advertises only the read-only quote tool", async () => {
  const tools = await new MarketData({ logger: silent }).listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "get_quote");
});
