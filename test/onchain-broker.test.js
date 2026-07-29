import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEther } from "ethers";
import { OnchainBroker } from "../src/onchain-broker.js";
import { WalletVault } from "../src/wallet-vault.js";
import { Store } from "../src/store.js";

const CONFIG = {
  maxOrderUsd: 100,
  gasReserveEth: 0.0002,
  slippageBps: 50,
  maxSlippageBps: 500,
  maxPriceImpactBps: 150,
  maxPriceImpactUnverifiedBps: 700,
  blockscoutBaseUrl: "https://example.invalid"
};
const NVDA = { address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", symbol: "NVDA", name: "NVIDIA • Robinhood Token", official: true, priceUsd: 197 };

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

async function makeBroker({ balanceEth = 0, balanceUsdg = 0, resolveTo = NVDA, hasRoute = true, routeOut = 252_500_000_000_000_000n, swapDelayMs = 0, config = CONFIG } = {}) {
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
      findBestRoute: async () => (hasRoute ? { kind: "single", amountOut: routeOut } : null),
      swap: async (signer, tokenIn, tokenOut, amountIn, opts) => {
        swaps.push({ tokenIn, token: tokenOut, amountIn, route: opts?.route });
        if (swapDelayMs) await new Promise((resolve) => setTimeout(resolve, swapDelayMs));
        return { hash: "0xabc", quotedOut: routeOut, minAmountOut: 1n, route: "single" };
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

test("a thin pool is refused by the price-impact guard before any swap", async () => {
  // 0.2 NVDA out for $50 at an indexed $197 is a ~21% haircut.
  const { broker, swaps } = await makeBroker({ balanceEth: 1, routeOut: 200_000_000_000_000_000n });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "NVDA" }, parentText: "", dryRun: false
  });
  assert.match(result.reply, /price impact/);
  assert.equal(swaps.length, 0);
});

test("buys for the same wallet run one at a time", async () => {
  const { broker, swaps } = await makeBroker({ balanceEth: 1, swapDelayMs: 30 });
  const order = [];
  const original = broker.executeBuy.bind(broker);
  broker.executeBuy = async (request) => {
    order.push(`start-${request.intent.amountUsd}`);
    const result = await original(request);
    order.push(`end-${request.intent.amountUsd}`);
    return result;
  };
  const buy = (amountUsd) => broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd, term: "NVDA" }, parentText: "", dryRun: false
  });
  await Promise.all([buy(10), buy(20)]);
  assert.deepEqual(order, ["start-10", "end-10", "start-20", "end-20"]);
  assert.equal(swaps.length, 2);
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

test("liquidity, not the explorer, decides which same-ticker token is real", async () => {
  const REAL = "0x3333333333333333333333333333333333333333";
  const SCAM = "0x4444444444444444444444444444444444444444";
  const { broker } = await makeBroker();
  // The scam quotes a huge buy but nothing on the way back out, which is what
  // a pool rigged to swallow funds looks like from the chain's side.
  broker.dex.findBestRoute = async (tokenIn, tokenOut, amountIn) => {
    if (tokenOut === SCAM) return { kind: "single", amountOut: amountIn * 1000n };
    if (tokenIn === SCAM) return { kind: "single", amountOut: 1n };
    if (tokenOut === REAL) return { kind: "single", amountOut: amountIn * 10n };
    if (tokenIn === REAL) return { kind: "single", amountOut: amountIn / 10n };
    return null;
  };
  const picked = await broker.pickByLiquidity([
    { address: SCAM, symbol: "WOJ", priceUsd: 9 },
    { address: REAL, symbol: "WOJ", priceUsd: 0.001 }
  ]);
  assert.equal(picked.address, REAL);
});

test("a ticker with no fillable pool is refused, not guessed at", async () => {
  const { broker } = await makeBroker();
  broker.dex.findBestRoute = async () => null;
  const picked = await broker.pickByLiquidity([{ address: "0x5555555555555555555555555555555555555555", symbol: "GHOST" }]);
  assert.equal(picked, null);
});

test("slippage tracks how much the pool actually moves", async () => {
  // A deep pool gets a tight bound; a thin one gets enough room to fill.
  const tight = await makeBroker({ balanceEth: 1 });
  const captured = [];
  tight.broker.dex.swap = async (signer, tokenIn, tokenOut, amountIn, opts) => {
    captured.push(opts.slippageBps);
    return { hash: "0x1", quotedOut: 10n ** 17n, minAmountOut: 1n, route: "single" };
  };
  // Round trip loses ~1%, so one-way impact reads as ~0.5%: near-base slippage.
  tight.broker.dex.findBestRoute = async (tokenIn, tokenOut, amountIn) =>
    ({ kind: "single", amountOut: tokenIn === NVDA.address ? (amountIn * 99n) / 100n : 252_500_000_000_000_000n });
  await tight.broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "NVDA" }, parentText: "", dryRun: false
  });
  assert.ok(captured[0] <= 100, `deep pool slippage was ${captured[0]}bps`);
  assert.ok(captured[0] >= 50);
});

test("a fill that cost real money says so in the reply", async () => {
  const { broker } = await makeBroker({ balanceEth: 1, resolveTo: { ...NVDA, official: false, priceUsd: 197 } });
  // Quote comes in ~4% under the indexed value: inside the unverified budget,
  // but the user is told what it cost.
  broker.dex.findBestRoute = async (tokenIn, tokenOut, amountIn) =>
    ({ kind: "single", amountOut: tokenIn === NVDA.address ? (amountIn * 92n) / 100n : 243_600_000_000_000_000n });
  const result = await broker.handleBuy({
    botUsername: "mybot", authorId: "1", username: "alice",
    intent: { wantsBuy: true, amountUsd: 50, term: "NVDA" }, parentText: "", dryRun: false
  });
  assert.match(result.reply, /price impact/);
});
