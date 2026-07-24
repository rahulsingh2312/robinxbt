import test from "node:test";
import assert from "node:assert/strict";
import { normalizePortfolio, publicSummary } from "../src/portfolio.js";

test("normalizes and sorts public holdings", () => {
  const portfolio = normalizePortfolio({
    totalValueUsd: 2500,
    hideValues: false,
    holdings: [
      { symbol: "eth", quantity: 0.5, valueUsd: 1500 },
      { symbol: "btc", quantity: 0.01, valueUsd: 1000 }
    ]
  });

  assert.equal(portfolio.holdings[0].symbol, "ETH");
  assert.equal(publicSummary({ portfolio }), "ETH · BTC");
});

test("rejects an invalid holding symbol", () => {
  assert.throws(() => normalizePortfolio({
    totalValueUsd: 1,
    holdings: [{ symbol: "not valid", quantity: 1, valueUsd: 1 }]
  }), /unsupported characters/);
});
