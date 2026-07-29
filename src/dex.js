import { AbiCoder, Contract, MaxUint256, ZeroAddress } from "ethers";

// Uniswap v4 on Robinhood Chain (chain id 4663), from the official Uniswap
// deployment registry. Stock Tokens and memecoins both trade here; the USDG
// stablecoin is the quote asset for most stock pools, ETH for most memecoins.
export const DEX_ADDRESSES = {
  universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
  quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
};

// In v4 the native coin is currency address(0); no WETH wrapping, and an
// ETH-in swap needs no token approval at all. ERC-20 inputs (USDG buys,
// sells) settle through Permit2, which ensureAllowances() prepares.
export const NATIVE = ZeroAddress;

const QUOTER_ABI = [
  "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
  "function quoteExactInput((address exactCurrency, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path, uint128 exactAmount) params) returns (uint256 amountOut, uint256 gasEstimate)"
];

const ROUTER_ABI = ["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"];

const PERMIT2_ABI = [
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)"
];

const ERC20_ALLOWANCE_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)"
];

// Universal Router command / v4 action bytes, from Commands.sol and Actions.sol.
const V4_SWAP = "0x10";
const ACTIONS = { SWAP_EXACT_IN_SINGLE: 0x06, SWAP_EXACT_IN: 0x07, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f };

const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;

// Standard hookless fee tiers. Pools with hooks (dynamic fees, market-hours
// gates) cannot be guessed, so discovery can be extended per token via the
// registry the resolver returns.
const FEE_TIERS = [[100, 1], [500, 10], [3000, 60], [10000, 200]];

const coder = AbiCoder.defaultAbiCoder();

function sortCurrencies(a, b) {
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

function sameAddress(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

export class Dex {
  constructor({ provider, addresses = DEX_ADDRESSES, slippageBps = 100 }) {
    this.provider = provider;
    this.addresses = addresses;
    this.slippageBps = slippageBps;
    this.quoterContract = new Contract(addresses.quoter, QUOTER_ABI, provider);
    this.usdgMetaCache = null;
  }

  poolKey(tokenA, tokenB, fee, tickSpacing) {
    const [currency0, currency1] = sortCurrencies(tokenA, tokenB);
    return { currency0, currency1, fee, tickSpacing, hooks: ZeroAddress };
  }

  async quoteSingle(tokenIn, tokenOut, fee, tickSpacing, amountIn) {
    const key = this.poolKey(tokenIn, tokenOut, fee, tickSpacing);
    const zeroForOne = sameAddress(key.currency0, tokenIn);
    const [amountOut] = await this.quoterContract.quoteExactInputSingle.staticCall({
      poolKey: key, zeroForOne, exactAmount: amountIn, hookData: "0x"
    });
    return { kind: "single", tokenIn, poolKey: key, zeroForOne, amountOut };
  }

  async quotePath(tokenIn, path, amountIn) {
    const [amountOut] = await this.quoterContract.quoteExactInput.staticCall({
      exactCurrency: tokenIn, path, exactAmount: amountIn
    });
    return { kind: "path", tokenIn, path, amountOut };
  }

  // Tries every hookless candidate route between two assets — direct pools on
  // each fee tier plus two-hop through the hub currencies (ETH, USDG) — and
  // keeps whichever quotes the most output. No live pool yields null, which
  // callers turn into an honest "no market" answer instead of a revert.
  // Direct pools only. Multi-hop paths were quoting nonsense and reverting on
  // execution, and a swap that cannot be trusted to price itself has no
  // business moving someone's money; callers hop through ETH explicitly
  // instead, one proven single-hop swap at a time.
  async findBestRoute(tokenIn, tokenOut, amountInWei) {
    const attempts = FEE_TIERS.map(([fee, tickSpacing]) =>
      this.quoteSingle(tokenIn, tokenOut, fee, tickSpacing, amountInWei).catch(() => null)
    );
    const routes = (await Promise.all(attempts)).filter(Boolean).filter((route) => route.amountOut > 0n);
    if (routes.length === 0) return null;
    const best = routes.reduce((a, b) => (b.amountOut > a.amountOut ? b : a));
    return { ...best, venue: "v4" };
  }

  // USD sizing runs through the ETH/USDG pool: how many dollars one ETH buys
  // right now IS the exchange rate the user's buy will actually clear at.
  // Cached briefly because every buy asks and the public RPC is rate limited.
  async ethUsdPrice() {
    if (this.priceCache && Date.now() - this.priceCache.at < 30_000) return this.priceCache.value;
    const attempts = FEE_TIERS.map(([fee, tick]) =>
      this.quoteSingle(NATIVE, this.addresses.usdg, fee, tick, 10n ** 18n).catch(() => null)
    );
    const routes = (await Promise.all(attempts)).filter(Boolean).filter((route) => route.amountOut > 0n);
    if (routes.length === 0) throw new Error("No ETH/USDG pool found to price USD orders");
    const best = routes.reduce((a, b) => (b.amountOut > a.amountOut ? b : a));
    const value = Number(best.amountOut) / 10 ** (await this.usdgDecimals());
    this.priceCache = { value, at: Date.now() };
    return value;
  }

  async usdgDecimals() {
    if (this.usdgMetaCache === null) {
      const usdg = new Contract(this.addresses.usdg, ["function decimals() view returns (uint8)"], this.provider);
      this.usdgMetaCache = Number(await usdg.decimals());
    }
    return this.usdgMetaCache;
  }

  minOut(amountOut, slippageBps = null) {
    const bps = slippageBps ?? this.slippageBps;
    return (amountOut * BigInt(10000 - bps)) / 10000n;
  }

  // Encodes UniversalRouter.execute for an exact-in swap in either direction.
  // SETTLE_ALL pays the input (ETH by value, ERC-20 through Permit2), TAKE_ALL
  // sweeps the full output back to the sender, and minOut makes slippage
  // revert on-chain rather than fill badly.
  buildSwapCalldata(route, tokenOut, amountInWei, minAmountOut, deadline) {
    let actions;
    let swapParams;
    if (route.kind === "single") {
      actions = Buffer.from([ACTIONS.SWAP_EXACT_IN_SINGLE, ACTIONS.SETTLE_ALL, ACTIONS.TAKE_ALL]);
      swapParams = coder.encode(
        ["tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)"],
        [[
          [route.poolKey.currency0, route.poolKey.currency1, route.poolKey.fee, route.poolKey.tickSpacing, route.poolKey.hooks],
          route.zeroForOne, amountInWei, minAmountOut, "0x"
        ]]
      );
    } else {
      actions = Buffer.from([ACTIONS.SWAP_EXACT_IN, ACTIONS.SETTLE_ALL, ACTIONS.TAKE_ALL]);
      swapParams = coder.encode(
        ["tuple(address,tuple(address,uint24,int24,address,bytes)[],uint128,uint128)"],
        [[
          route.tokenIn,
          route.path.map((hop) => [hop.intermediateCurrency, hop.fee, hop.tickSpacing, hop.hooks, hop.hookData]),
          amountInWei, minAmountOut
        ]]
      );
    }
    const params = [
      swapParams,
      coder.encode(["address", "uint256"], [route.tokenIn, amountInWei]),
      coder.encode(["address", "uint256"], [tokenOut, minAmountOut])
    ];
    const input = coder.encode(["bytes", "bytes[]"], ["0x" + actions.toString("hex"), params]);
    return { commands: V4_SWAP, inputs: [input], deadline };
  }

  // ERC-20 inputs settle via Permit2, which needs two standing approvals:
  // token -> Permit2, and Permit2 -> Universal Router. Both are granted once
  // at max and reused, so the first sell/USDG-buy costs two extra cheap L2
  // transactions and later ones cost none.
  async ensureAllowances(signer, token, amountIn) {
    const owner = await signer.getAddress();
    const erc20 = new Contract(token, ERC20_ALLOWANCE_ABI, signer);
    if ((await erc20.allowance(owner, this.addresses.permit2)) < amountIn) {
      await (await erc20.approve(this.addresses.permit2, MaxUint256)).wait();
    }
    const permit2 = new Contract(this.addresses.permit2, PERMIT2_ABI, signer);
    const [allowed, expiration] = await permit2.allowance(owner, token, this.addresses.universalRouter);
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    if (allowed < amountIn || expiration <= nowSeconds) {
      await (await permit2.approve(token, this.addresses.universalRouter, MAX_UINT160, MAX_UINT48)).wait();
    }
  }

  // Quotes, applies slippage, sends, and waits for inclusion. `signer` holds
  // the owner's own key; ETH input is sent as value, ERC-20 input via Permit2.
  // A caller that already discovered a sized route passes it to avoid a
  // second full quote sweep against the rate-limited RPC.
  async swap(signer, tokenIn, tokenOut, amountInWei, { route: presetRoute = null, slippageBps = null } = {}) {
    const route = presetRoute ?? await this.findBestRoute(tokenIn, tokenOut, amountInWei);
    if (!route) throw new Error("no liquidity route found for this pair");
    if (!sameAddress(tokenIn, NATIVE)) await this.ensureAllowances(signer, tokenIn, amountInWei);
    // The caller sizes slippage per asset: a deep stock pool needs almost
    // none, a thin memecoin pool needs real room or every buy reverts.
    const minAmountOut = this.minOut(route.amountOut, slippageBps);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
    const { commands, inputs } = this.buildSwapCalldata(route, tokenOut, amountInWei, minAmountOut, deadline);
    const router = new Contract(this.addresses.universalRouter, ROUTER_ABI, signer);
    const tx = await router.execute(commands, inputs, deadline, { value: sameAddress(tokenIn, NATIVE) ? amountInWei : 0n });
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(`swap reverted in tx ${receipt.hash}`);
    return { hash: receipt.hash, quotedOut: route.amountOut, minAmountOut, route: route.kind };
  }

  async swapEthForToken(signer, tokenOut, amountInWei) {
    return this.swap(signer, NATIVE, tokenOut, amountInWei);
  }
}
