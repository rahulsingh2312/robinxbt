import { Contract, ZeroAddress } from "ethers";

// Uniswap v3 on Robinhood Chain. The third venue, and not a small one: the
// deepest memecoin pools on this chain are v3, including tokens with hundreds
// of millions in liquidity that v2 and v4 discovery cannot see at all.
export const V3_ADDRESSES = {
  factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  quoter: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  router: "0xCaf681a66D020601342297493863E78C959E5cb2",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
};

const FEE_TIERS = [100, 500, 3000, 10000];

// Hubs for two-hop paths, in the order worth trying.
const HUBS = [
  "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", // WETH
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", // USDG
  "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31"  // VIRTUAL
];

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function refundETH() payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)"
];

const ERC20_ABI = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];

// v3 paths are packed bytes: token (20) | fee (3) | token (20) | ...
function encodePath(tokens, fees) {
  let path = tokens[0].toLowerCase().replace(/^0x/, "");
  for (const [index, fee] of fees.entries()) {
    path += fee.toString(16).padStart(6, "0");
    path += tokens[index + 1].toLowerCase().replace(/^0x/, "");
  }
  return `0x${path}`;
}

export class DexV3 {
  constructor({ provider, addresses = V3_ADDRESSES, slippageBps = 300 }) {
    this.provider = provider;
    this.addresses = addresses;
    this.slippageBps = slippageBps;
    this.quoter = new Contract(addresses.quoter, QUOTER_ABI, provider);
    this.router = new Contract(addresses.router, ROUTER_ABI, provider);
  }

  // v3 wraps ETH like v2 does, so address(0) becomes WETH on the path and the
  // router is told to unwrap on the way out.
  asPathToken(token) {
    return token === ZeroAddress ? this.addresses.weth : token;
  }

  async findBestRoute(tokenIn, tokenOut, amountIn) {
    const from = this.asPathToken(tokenIn);
    const to = this.asPathToken(tokenOut);
    if (from.toLowerCase() === to.toLowerCase()) return null;

    const attempts = [];
    for (const fee of FEE_TIERS) {
      attempts.push(this.quoteSingle(from, to, fee, amountIn));
    }
    for (const hub of HUBS) {
      if (hub.toLowerCase() === from.toLowerCase() || hub.toLowerCase() === to.toLowerCase()) continue;
      for (const feeIn of FEE_TIERS) {
        for (const feeOut of FEE_TIERS) {
          attempts.push(this.quotePath([from, hub, to], [feeIn, feeOut], amountIn));
        }
      }
    }
    const routes = (await Promise.all(attempts)).filter(Boolean).filter((route) => route.amountOut > 0n);
    if (routes.length === 0) return null;
    return routes.reduce((best, route) => (route.amountOut > best.amountOut ? route : best));
  }

  async quoteSingle(from, to, fee, amountIn) {
    try {
      const [amountOut] = await this.quoter.quoteExactInputSingle.staticCall({
        tokenIn: from, tokenOut: to, amountIn, fee, sqrtPriceLimitX96: 0n
      });
      return { venue: "v3", kind: "v3-single", tokens: [from, to], fees: [fee], amountOut };
    } catch {
      return null;
    }
  }

  async quotePath(tokens, fees, amountIn) {
    try {
      const [amountOut] = await this.quoter.quoteExactInput.staticCall(encodePath(tokens, fees), amountIn);
      return { venue: "v3", kind: "v3-path", tokens, fees, amountOut };
    } catch {
      return null;
    }
  }

  minOut(amountOut, slippageBps = null) {
    return (amountOut * BigInt(10000 - (slippageBps ?? this.slippageBps))) / 10000n;
  }

  async swap(signer, tokenIn, tokenOut, amountIn, { route = null, slippageBps = null, maxSlippageBps = 5000 } = {}) {
    const chosen = route ?? await this.findBestRoute(tokenIn, tokenOut, amountIn);
    if (!chosen) throw new Error("no v3 route found for this pair");
    const recipient = await signer.getAddress();
    if (tokenIn !== ZeroAddress) await this.ensureAllowance(signer, tokenIn, amountIn);

    // Selling into native ETH means the router keeps the WETH and unwraps it
    // in a second call, so those go out as a multicall.
    const toNative = tokenOut === ZeroAddress;
    const build = (minAmountOut) => {
      const swapData = chosen.kind === "v3-single"
        ? this.router.interface.encodeFunctionData("exactInputSingle", [{
            tokenIn: chosen.tokens[0], tokenOut: chosen.tokens[1], fee: chosen.fees[0],
            recipient: toNative ? this.addresses.router : recipient,
            amountIn, amountOutMinimum: minAmountOut, sqrtPriceLimitX96: 0n
          }])
        : this.router.interface.encodeFunctionData("exactInput", [{
            path: encodePath(chosen.tokens, chosen.fees),
            recipient: toNative ? this.addresses.router : recipient,
            amountIn, amountOutMinimum: minAmountOut
          }]);
      if (!toNative) return { data: swapData, value: tokenIn === ZeroAddress ? amountIn : 0n };
      const unwrap = this.router.interface.encodeFunctionData("unwrapWETH9", [minAmountOut, recipient]);
      return {
        data: this.router.interface.encodeFunctionData("multicall", [[swapData, unwrap]]),
        value: 0n
      };
    };

    // Same reasoning as v2: simulate first, widen only as far as allowed, and
    // never send a transaction the chain has already refused.
    const start = slippageBps ?? this.slippageBps;
    const ladder = [...new Set([start, 300, 600, 1200, 2500, maxSlippageBps])]
      .filter((bps) => bps >= start && bps <= maxSlippageBps)
      .sort((a, b) => a - b);

    let accepted = null;
    let lastError;
    for (const bps of ladder) {
      const minAmountOut = this.minOut(chosen.amountOut, bps);
      const { data, value } = build(minAmountOut);
      try {
        await this.provider.call({ to: this.addresses.router, from: recipient, data, value });
        accepted = { data, value, minAmountOut };
        break;
      } catch (error) {
        lastError = error;
        if (!/Too little received|STF|slippage|amountOutMinimum/i.test(String(error.shortMessage ?? error.message))) break;
      }
    }
    if (!accepted) throw lastError ?? new Error("v3 swap could not be priced within the allowed slippage");

    const receipt = await (await signer.sendTransaction({ to: this.addresses.router, data: accepted.data, value: accepted.value })).wait();
    if (receipt.status !== 1) throw new Error(`v3 swap reverted in tx ${receipt.hash}`);
    return { hash: receipt.hash, quotedOut: chosen.amountOut, minAmountOut: accepted.minAmountOut, route: "v3" };
  }

  async ensureAllowance(signer, token, amountIn) {
    const owner = await signer.getAddress();
    const erc20 = new Contract(token, ERC20_ABI, signer);
    if ((await erc20.allowance(owner, this.addresses.router)) >= amountIn) return;
    await (await erc20.approve(this.addresses.router, (1n << 256n) - 1n)).wait();
  }
}
