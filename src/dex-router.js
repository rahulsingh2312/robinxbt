// One interface over both venues. Liquidity on this chain is split: stock
// tokens and the deep memecoin pools are on Uniswap v4, while Virtuals agent
// tokens and a long tail of others only exist as v2 pairs. Quoting one venue
// and calling the answer "no market" was telling people their token does not
// trade when it trades fine somewhere the bot was not looking.
//
// Both venues are quoted for every request and the better fill wins. Routes
// carry their own venue, so execution always goes back to whichever one
// produced the quote.
export class DexRouter {
  constructor({ v4, v2, logger = console }) {
    this.v4 = v4;
    this.v2 = v2;
    this.logger = logger;
    // Callers reach through for these; they are venue-independent.
    this.addresses = v4.addresses;
  }

  async findBestRoute(tokenIn, tokenOut, amountIn) {
    const [fromV4, fromV2] = await Promise.all([
      this.v4.findBestRoute(tokenIn, tokenOut, amountIn).catch(() => null),
      this.v2.findBestRoute(tokenIn, tokenOut, amountIn).catch(() => null)
    ]);
    if (fromV4 && !fromV4.venue) fromV4.venue = "v4";
    if (!fromV4) return fromV2;
    if (!fromV2) return fromV4;
    return fromV2.amountOut > fromV4.amountOut ? fromV2 : fromV4;
  }

  async swap(signer, tokenIn, tokenOut, amountIn, options = {}) {
    const route = options.route ?? await this.findBestRoute(tokenIn, tokenOut, amountIn);
    if (!route) throw new Error("no liquidity route found for this pair");
    const venue = route.venue === "v2" ? this.v2 : this.v4;
    return venue.swap(signer, tokenIn, tokenOut, amountIn, { ...options, route });
  }

  minOut(amountOut, slippageBps = null) {
    return this.v4.minOut(amountOut, slippageBps);
  }

  async ethUsdPrice() {
    return this.v4.ethUsdPrice();
  }

  async usdgDecimals() {
    return this.v4.usdgDecimals();
  }
}
