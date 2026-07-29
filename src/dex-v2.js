import { Contract, ZeroAddress } from "ethers";

// Uniswap v2 on Robinhood Chain. v4 has the stock tokens and the big memecoin
// pools, but a large part of the chain — every Virtuals agent token, for one —
// lives in plain v2 pairs that v4 route discovery cannot see at all. A token
// the whole timeline is talking about being "not tradable" is a worse failure
// than supporting a second venue.
export const V2_ADDRESSES = {
  factory: "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f",
  router: "0x89e5db8b5aa49aa85ac63f691524311aeb649eba"
};

// Intermediate currencies worth trying when there is no direct pair. VIRTUAL
// is here because Virtuals agent tokens are only ever paired against it.
const HUBS = [
  "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31", // VIRTUAL
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"  // USDG
];

const ROUTER_ABI = [
  "function WETH() view returns (address)",
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)"
];

const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
const ERC20_ABI = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];

export class DexV2 {
  constructor({ provider, addresses = V2_ADDRESSES, slippageBps = 300 }) {
    this.provider = provider;
    this.addresses = addresses;
    this.slippageBps = slippageBps;
    this.router = new Contract(addresses.router, ROUTER_ABI, provider);
    this.factory = new Contract(addresses.factory, FACTORY_ABI, provider);
    this.wethCache = null;
  }

  // v2 has no native currency: ETH is wrapped, so every path starts or ends
  // at WETH and the router handles the wrapping.
  async weth() {
    this.wethCache ??= await this.router.WETH();
    return this.wethCache;
  }

  // Native ETH is address(0) in the rest of this codebase; v2 speaks WETH.
  async asPathToken(token) {
    return token === ZeroAddress ? await this.weth() : token;
  }

  async pairExists(tokenA, tokenB) {
    const pair = await this.factory.getPair(tokenA, tokenB).catch(() => ZeroAddress);
    return pair && pair !== ZeroAddress;
  }

  // Tries the direct pair first, then one hop through each hub. Returns the
  // best-quoting path in the same shape v4 routes use, so callers can treat
  // the two venues identically.
  async findBestRoute(tokenIn, tokenOut, amountIn) {
    const from = await this.asPathToken(tokenIn);
    const to = await this.asPathToken(tokenOut);
    if (from.toLowerCase() === to.toLowerCase()) return null;

    const candidates = [[from, to]];
    for (const hub of HUBS) {
      if (hub.toLowerCase() === from.toLowerCase() || hub.toLowerCase() === to.toLowerCase()) continue;
      candidates.push([from, hub, to]);
    }
    // WETH as an intermediate matters when neither side is ETH.
    const weth = await this.weth();
    if (from.toLowerCase() !== weth.toLowerCase() && to.toLowerCase() !== weth.toLowerCase()) {
      candidates.push([from, weth, to]);
    }

    const quoted = await Promise.all(candidates.map(async (path) => {
      try {
        const amounts = await this.router.getAmountsOut(amountIn, path);
        const amountOut = amounts[amounts.length - 1];
        return amountOut > 0n ? { venue: "v2", kind: "v2", tokenIn, path, amountOut } : null;
      } catch {
        return null;
      }
    }));

    const routes = quoted.filter(Boolean);
    if (routes.length === 0) return null;
    return routes.reduce((best, route) => (route.amountOut > best.amountOut ? route : best));
  }

  minOut(amountOut, slippageBps = null) {
    return (amountOut * BigInt(10000 - (slippageBps ?? this.slippageBps))) / 10000n;
  }

  // The fee-on-transfer variants are used throughout: plenty of memecoins tax
  // transfers, and the plain functions revert on them rather than filling.
  async swap(signer, tokenIn, tokenOut, amountIn, { route = null, slippageBps = null } = {}) {
    const chosen = route ?? await this.findBestRoute(tokenIn, tokenOut, amountIn);
    if (!chosen) throw new Error("no v2 route found for this pair");
    const minAmountOut = this.minOut(chosen.amountOut, slippageBps);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const to = await signer.getAddress();
    const router = this.router.connect(signer);

    let tx;
    if (tokenIn === ZeroAddress) {
      tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(minAmountOut, chosen.path, to, deadline, { value: amountIn });
    } else {
      await this.ensureAllowance(signer, tokenIn, amountIn);
      tx = tokenOut === ZeroAddress
        ? await router.swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, minAmountOut, chosen.path, to, deadline)
        : await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn, minAmountOut, chosen.path, to, deadline);
    }
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(`v2 swap reverted in tx ${receipt.hash}`);
    return { hash: receipt.hash, quotedOut: chosen.amountOut, minAmountOut, route: "v2" };
  }

  async ensureAllowance(signer, token, amountIn) {
    const owner = await signer.getAddress();
    const erc20 = new Contract(token, ERC20_ABI, signer);
    if ((await erc20.allowance(owner, this.addresses.router)) >= amountIn) return;
    await (await erc20.approve(this.addresses.router, (1n << 256n) - 1n)).wait();
  }
}
