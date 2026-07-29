// Simulates real buys against the live chain for whatever is actually trading
// on Robinhood Chain right now. Unit tests mock the chain, which is why every
// failure so far — the multi-hop encoding, USDG-only stock pools, v2-only
// tokens, the tax-driven slippage revert — reached a user before a test.
//
// Nothing here signs anything: every swap is an eth_call from the wallet's
// address, so a revert here is exactly the revert a user would have seen.
//
// Usage: npm run sim:chain [count]
import { ChainClient } from "../../src/chain.js";
import { Dex } from "../../src/dex.js";
import { DexV2 } from "../../src/dex-v2.js";
import { DexV3 } from "../../src/dex-v3.js";
import { DexRouter } from "../../src/dex-router.js";
import { AssetResolver } from "../../src/asset-resolver.js";
import { loadConfig } from "../../src/config.js";
import { Interface, ZeroAddress } from "ethers";

const config = loadConfig();
const WALLET = process.env.SIM_WALLET ?? "0x6037bF867a7C49793D2933b334273148189e60C6";
const LIMIT = Number(process.argv[2] ?? 25);
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const chain = new ChainClient({ rpcUrl: config.onchain.rpcUrl });
const v4 = new Dex({ provider: chain.provider, slippageBps: config.onchain.slippageBps });
const v2 = new DexV2({ provider: chain.provider, slippageBps: config.onchain.slippageBps });
const v3 = new DexV3({ provider: chain.provider, slippageBps: config.onchain.slippageBps });
const dex = new DexRouter({ v4, v3, v2 });
const resolver = new AssetResolver({ baseUrl: config.onchain.blockscoutBaseUrl, logger: { warn() {} } });

// Whatever is actually trading on this chain right now, straight from the pair
// index, so the list tracks reality instead of a hand-written fixture.
const QUOTE_SYMBOLS = new Set(["USDG", "WETH", "ETH", "USDC", "USDT"]);

async function liveTokens(limit) {
  const seen = new Map();
  // Several queries, because the pair index returns matches rather than a
  // directory. Quote currencies and dust pools are dropped: neither tells us
  // anything about whether a user's buy would work.
  for (const query of ["virtuals", "cat", "robinhood chain", "meme", "agent", "IN", "USDG"]) {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`).catch(() => null);
    if (!response?.ok) continue;
    const body = await response.json();
    for (const pair of body.pairs ?? []) {
      if (!String(pair.chainId ?? "").toLowerCase().includes("robinhood")) continue;
      const token = pair.baseToken;
      const liquidityUsd = Number(pair.liquidity?.usd ?? 0);
      if (!token?.address || QUOTE_SYMBOLS.has(String(token.symbol).toUpperCase())) continue;
      if (liquidityUsd < 10_000) continue;
      const existing = seen.get(token.address);
      if (existing) { existing.liquidityUsd += liquidityUsd; continue; }
      seen.set(token.address, { symbol: token.symbol, address: token.address, liquidityUsd });
    }
  }
  // Stock tokens live on v4 and never appear in the memecoin pair search.
  for (const ticker of ["NVDA", "AAPL", "TSLA", "SPY", "MSFT", "AMZN"]) {
    const asset = await resolver.resolve(ticker).catch(() => null);
    if (asset?.address) seen.set(asset.address, { symbol: asset.symbol, address: asset.address, liquidityUsd: Infinity, official: true });
  }
  return [...seen.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, limit);
}

const V2_IFACE = new Interface([
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable"
]);
const V4_IFACE = new Interface(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

// Runs the exact transaction the bot would send, as a call.
async function simulate(route, tokenOut, amountIn, slippageBps) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  if (route.venue === "v2") {
    const minOut = v2.minOut(route.amountOut, slippageBps);
    const data = V2_IFACE.encodeFunctionData("swapExactETHForTokensSupportingFeeOnTransferTokens", [minOut, route.path, WALLET, deadline]);
    await chain.provider.call({ to: v2.addresses.router, from: WALLET, data, value: amountIn });
    return;
  }
  if (route.venue === "v3") {
    // v3 builds and simulates its own calldata, so the check is the real one.
    const minOut = v3.minOut(route.amountOut, slippageBps);
    const data = route.kind === "v3-single"
      ? v3.router.interface.encodeFunctionData("exactInputSingle", [{
          tokenIn: route.tokens[0], tokenOut: route.tokens[1], fee: route.fees[0],
          recipient: WALLET, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n
        }])
      : v3.router.interface.encodeFunctionData("exactInput", [{
          path: route.tokens.reduce((acc, token, index) => index === 0 ? token.toLowerCase() : acc + route.fees[index - 1].toString(16).padStart(6, "0") + token.toLowerCase().replace(/^0x/, ""), ""),
          recipient: WALLET, amountIn, amountOutMinimum: minOut
        }]);
    await chain.provider.call({ to: v3.addresses.router, from: WALLET, data, value: amountIn });
    return;
  }
  const minOut = v4.minOut(route.amountOut, slippageBps);
  const { commands, inputs } = v4.buildSwapCalldata(route, tokenOut, amountIn, minOut, deadline);
  const data = V4_IFACE.encodeFunctionData("execute", [commands, inputs, deadline]);
  await chain.provider.call({ to: v4.addresses.universalRouter, from: WALLET, data, value: amountIn });
}

const tokens = await liveTokens(LIMIT);
console.log(`Simulating $1 buys against ${tokens.length} tokens actually trading on Robinhood Chain\n`);

const ethUsd = await dex.ethUsdPrice();
const amountIn = BigInt(Math.round((1 / ethUsd) * 1e18));
const results = { filled: [], noRoute: [], reverted: [] };

for (const token of tokens) {
  const route = await dex.findBestRoute(ZeroAddress, token.address, amountIn).catch(() => null);
  if (!route) {
    results.noRoute.push(token.symbol);
    console.log(`  ✗ ${token.symbol.padEnd(10)} no route on either venue`);
    continue;
  }
  // The same ladder the live code walks, so this reports what a user gets.
  let filledAt = null;
  for (const bps of [config.onchain.slippageBps, 300, 600, 1200, 2500, config.onchain.maxSlippageBps]) {
    try {
      await simulate(route, token.address, amountIn, bps);
      filledAt = bps;
      break;
    } catch {
      // keep widening
    }
  }
  if (filledAt === null) {
    results.reverted.push(token.symbol);
    console.log(`  ✗ ${token.symbol.padEnd(10)} ${route.venue} route quotes but every slippage reverts`);
  } else {
    results.filled.push(token.symbol);
    console.log(`  ✓ ${token.symbol.padEnd(10)} ${route.venue}  fills at ${(filledAt / 100).toFixed(1)}% slippage`);
  }
}

console.log(`\n${results.filled.length}/${tokens.length} buyable`);
if (results.noRoute.length) console.log(`no route: ${results.noRoute.join(", ")}`);
if (results.reverted.length) console.log(`reverts:  ${results.reverted.join(", ")}`);
process.exitCode = results.reverted.length > 0 ? 1 : 0;
