import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEther } from "ethers";
import { OnchainBroker } from "../src/onchain-broker.js";
import { WalletVault } from "../src/wallet-vault.js";
import { Store } from "../src/store.js";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PEPE = "0x2222222222222222222222222222222222222222";
const NVDA = "0x3333333333333333333333333333333333333333";

const CONFIG = {
  maxOrderUsd: 100, gasReserveEth: 0.0002, slippageBps: 50, maxSlippageBps: 500,
  maxPriceImpactBps: 150, maxPriceImpactUnverifiedBps: 5000, blockscoutBaseUrl: "https://example.invalid"
};

async function makeBroker({ holdings = [], ethAmount = 0.01, tokenBalance = 10n ** 21n } = {}) {
  const store = new Store(path.join(mkdtempSync(path.join(tmpdir(), "sell-")), "store.json"));
  await store.load();
  const swaps = [];
  const broker = new OnchainBroker({
    store,
    vault: new WalletVault("d".repeat(64)),
    chain: {
      provider: {},
      getEthBalance: async () => parseEther(String(ethAmount)),
      getTokenBalance: async () => ({ raw: tokenBalance }),
      getTokenMeta: async () => ({ decimals: 18, symbol: "TOKEN" })
    },
    dex: {
      addresses: { usdg: USDG },
      usdgDecimals: async () => 6,
      ethUsdPrice: async () => 2000,
      findBestRoute: async (tokenIn, tokenOut) => (tokenOut === USDG ? null : { kind: "single", amountOut: 10n ** 16n }),
      swap: async (signer, tokenIn, tokenOut, amountIn) => {
        swaps.push({ tokenIn, tokenOut, amountIn });
        return { hash: "0xsell", quotedOut: 10n ** 16n, minAmountOut: 1n };
      }
    },
    resolver: { resolve: async () => null },
    config: CONFIG,
    logger: { info() {}, warn() {}, error() {} }
  });
  broker.fetchHoldings = async () => holdings;
  return { broker, swaps };
}

const PEPE_HOLDING = { symbol: "PEPE", name: "Pepe", address: PEPE, amount: 1000, priceUsd: 0.002, valueUsd: 2 };
const NVDA_HOLDING = { symbol: "NVDA", name: "NVIDIA", address: NVDA, amount: 0.05, priceUsd: 197, valueUsd: 9.85 };

test("selling a named holding swaps the whole position by default", async () => {
  const { broker, swaps } = await makeBroker({ holdings: [PEPE_HOLDING] });
  const result = await broker.handleSell({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsSell: true, term: "PEPE", portion: 1 }, dryRun: false
  });
  assert.equal(swaps.length, 1);
  assert.equal(swaps[0].tokenIn, PEPE);
  assert.equal(swaps[0].amountIn, 10n ** 21n, "should sell the full balance");
  assert.match(result.reply, /Sold/);
});

test("selling half sells half", async () => {
  const { broker, swaps } = await makeBroker({ holdings: [PEPE_HOLDING] });
  await broker.handleSell({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsSell: true, term: "PEPE", portion: 0.5 }, dryRun: false
  });
  assert.equal(swaps[0].amountIn, 10n ** 21n / 2n);
});

test("a dollar figure sells only that much", async () => {
  // $1 of a $0.002 token is 500 tokens, well under the 1000 held.
  const { broker, swaps } = await makeBroker({ holdings: [PEPE_HOLDING] });
  await broker.handleSell({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsSell: true, term: "PEPE", amountUsd: 1 }, dryRun: false
  });
  assert.equal(swaps[0].amountIn, 500n * 10n ** 18n);
});

test("selling more than you hold sells what you hold", async () => {
  const { broker, swaps } = await makeBroker({ holdings: [PEPE_HOLDING] });
  await broker.handleSell({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsSell: true, term: "PEPE", amountUsd: 9999 }, dryRun: false
  });
  assert.equal(swaps[0].amountIn, 10n ** 21n);
});

test("selling something you do not hold names what you do", async () => {
  const { broker, swaps } = await makeBroker({ holdings: [PEPE_HOLDING] });
  const result = await broker.handleSell({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsSell: true, term: "DOGE", portion: 1 }, dryRun: false
  });
  assert.equal(swaps.length, 0);
  assert.match(result.reply, /not holding any DOGE/i);
  assert.match(result.reply, /PEPE/);
});

test("selling with no gas explains itself instead of reverting", async () => {
  const { broker, swaps } = await makeBroker({ holdings: [PEPE_HOLDING], ethAmount: 0 });
  const result = await broker.handleSell({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsSell: true, term: "PEPE", portion: 1 }, dryRun: false
  });
  assert.equal(swaps.length, 0);
  assert.match(result.reply, /gas/i);
});

test("the portfolio reply ranks by value and compacts big numbers", async () => {
  const { broker } = await makeBroker({
    holdings: [
      { symbol: "SHIB", address: "0x9", amount: 62_400, priceUsd: 0.00005, valueUsd: 3.12 },
      NVDA_HOLDING
    ],
    ethAmount: 0.001
  });
  const reply = await broker.describePortfolio("mybot", "1", "alice");
  assert.match(reply, /Your bag: \$/);
  // Biggest position first, and a five-figure token count reads as 62.4K.
  assert.ok(reply.indexOf("NVDA") < reply.indexOf("SHIB"), "should rank by value");
  assert.match(reply, /62\.4K/);
  assert.match(reply, /link in bio/);
});

test("an empty wallet says so plainly", async () => {
  const { broker } = await makeBroker({ holdings: [], ethAmount: 0 });
  const reply = await broker.describePortfolio("mybot", "1", "alice");
  assert.match(reply, /Nothing in your wallet yet/);
});
