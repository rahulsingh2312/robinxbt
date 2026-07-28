import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEther } from "ethers";
import { OnchainBroker } from "../src/onchain-broker.js";
import { WalletVault } from "../src/wallet-vault.js";
import { Store } from "../src/store.js";

const CONFIG = { maxOrderUsd: 100, gasReserveEth: 0.0002, blockscoutBaseUrl: "https://example.invalid" };
const NVDA = { address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", symbol: "NVDA", name: "NVIDIA • Robinhood Token", official: true, priceUsd: 197 };

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

async function makeBroker({ balanceEth = 0, balanceUsdg = 0, resolveTo = NVDA, hasRoute = true, config = CONFIG } = {}) {
  const store = new Store(path.join(mkdtempSync(path.join(tmpdir(), "broker-test-")), "store.json"));
  await store.load();
  const swaps = [];
  const broker = new OnchainBroker({
    store,
    vault: new WalletVault("c".repeat(64)),
    chain: {
      provider: {},
      getEthBalance: async () => parseEther(String(balanceEth)),
      getTokenBalance: async () => ({ raw: BigInt(Math.round(balanceUsdg * 1e6)) }),
      getTokenMeta: async () => ({ decimals: 18, symbol: resolveTo?.symbol ?? "?" })
    },
    dex: {
      addresses: { usdg: USDG },
      usdgDecimals: async () => 6,
      ethUsdPrice: async () => 2000,
      findBestRoute: async () => (hasRoute ? { kind: "single" } : null),
      swap: async (signer, tokenIn, tokenOut, amountIn) => {
        swaps.push({ tokenIn, token: tokenOut, amountIn });
        return { hash: "0xabc", quotedOut: 10n ** 17n, minAmountOut: 1n, route: "single" };
      }
    },
    resolver: { resolve: async () => resolveTo },
    config,
    logger: { info() {}, warn() {}, error() {} }
  });
  return { broker, store, swaps };
}

test("asks what to buy when neither message nor context names an asset", async () => {
  const { broker } = await makeBroker();
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: null, term: null }, parentText: "", dryRun: true
  });
  assert.match(result.reply, /ticker.*contract address/i);
});

test("pulls the asset from the bot's earlier advice and asks for size", async () => {
  const { broker } = await makeBroker();
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: null, term: null },
    parentText: "I'd look hard at $NVDA here, earnings momentum is real",
    dryRun: true
  });
  assert.match(result.reply, /How much NVDA/);
  assert.equal(result.pendingBuy.term, NVDA.address);
  assert.equal(result.pendingBuy.authorId, "1");
});

test("unfunded wallet is sent to the site to fund, never a raw address", async () => {
  const { broker, swaps } = await makeBroker({ balanceEth: 0 });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "NVDA" }, parentText: "", dryRun: false
  });
  // X rejects posts containing crypto addresses, so the reply must point at
  // the portfolio site instead of embedding the deposit address.
  assert.ok(!/0x[0-9a-fA-F]{6}/.test(result.reply));
  assert.match(result.reply, /link in bio/);
  assert.match(result.reply, /more ETH \(or \$50 USDG/);
  assert.equal(swaps.length, 0);
});

test("ONCHAIN_ADDRESS_IN_REPLIES restores the inline deposit address", async () => {
  const { broker, store } = await makeBroker({ balanceEth: 0, config: { ...CONFIG, addressInReplies: true } });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "NVDA" }, parentText: "", dryRun: false
  });
  const wallet = await store.getWalletByAuthor("mybot", "1");
  assert.ok(result.reply.includes(wallet.address));
});

test("a wallet holding USDG but little ETH buys with USDG", async () => {
  const { broker, swaps } = await makeBroker({ balanceEth: 0.001, balanceUsdg: 100 });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "NVDA" }, parentText: "", dryRun: false
  });
  assert.equal(swaps.length, 1);
  assert.equal(swaps[0].tokenIn, USDG);
  assert.equal(swaps[0].amountIn, 50_000_000n); // $50 in 6-decimal USDG
  assert.match(result.reply, /Bought/);
});

test("USDG without gas ETH gets a precise gas ask, not a generic one", async () => {
  const { broker, swaps } = await makeBroker({ balanceEth: 0, balanceUsdg: 100 });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "NVDA" }, parentText: "", dryRun: false
  });
  assert.match(result.reply, /no ETH for gas/);
  assert.match(result.reply, /link in bio/);
  assert.equal(swaps.length, 0);
});

test("USDG wins over ETH when both could cover the buy", async () => {
  const { broker, swaps } = await makeBroker({ balanceEth: 5, balanceUsdg: 500 });
  await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "NVDA" }, parentText: "", dryRun: false
  });
  assert.equal(swaps[0].tokenIn, USDG);
});

test("funded wallet swaps and the reply points at the portfolio link in bio", async () => {
  const { broker, swaps } = await makeBroker({ balanceEth: 1 });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "NVDA" }, parentText: "", dryRun: false
  });
  assert.equal(swaps.length, 1);
  assert.equal(swaps[0].token, NVDA.address);
  // $50 at $2000/ETH = 0.025 ETH
  assert.equal(swaps[0].amountIn, parseEther("0.025"));
  assert.match(result.reply, /Bought/);
  assert.match(result.reply, /link in bio/);
  assert.equal(result.txHash, "0xabc");
});

test("dry run never reaches the dex", async () => {
  const { broker, swaps } = await makeBroker({ balanceEth: 1 });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "NVDA" }, parentText: "", dryRun: true
  });
  assert.match(result.reply, /dry run/);
  assert.equal(swaps.length, 0);
});

test("per-order cap refuses oversized buys before any chain call", async () => {
  const { broker, swaps } = await makeBroker({ balanceEth: 10 });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 5000, term: "NVDA" }, parentText: "", dryRun: false
  });
  assert.match(result.reply, /cap of \$100/);
  assert.equal(swaps.length, 0);
});

test("ambiguous tickers fail closed asking for the contract address", async () => {
  const { broker, swaps } = await makeBroker({ resolveTo: { ambiguous: true, count: 3 } });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "WOJAK" }, parentText: "", dryRun: false
  });
  assert.match(result.reply, /contract address/);
  assert.equal(swaps.length, 0);
});

test("a token with no live market is refused before any funding ask", async () => {
  const { broker, swaps } = await makeBroker({ balanceEth: 0, hasRoute: false });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 10, term: "DOGE" }, parentText: "", dryRun: false
  });
  assert.match(result.reply, /no tradable market/);
  // Crucially: no deposit address — nobody should fund a wallet for an unbuyable token.
  assert.ok(!result.reply.includes("0x"));
  assert.equal(swaps.length, 0);
});

test("a pending ask plus a bare amount completes the original buy", async () => {
  const { broker, swaps } = await makeBroker({ balanceEth: 1 });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: false, amountUsd: 25, term: null },
    pendingBuy: { authorId: "1", term: NVDA.address },
    parentText: "How much NVDA?",
    dryRun: false
  });
  assert.match(result.reply, /Bought/);
  assert.equal(swaps[0].amountIn, parseEther("0.0125"));
});
