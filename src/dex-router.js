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
  constructor({ v4, v3, v2, logger = console }) {
    this.venues = { v4, v3, v2 };
    this.v4 = v4;
    this.logger = logger;
    // Callers reach through for these; they are venue-independent.
    this.addresses = v4.addresses;
  }

  // Every venue is asked, always. Liquidity on this chain is split three ways
  // with no pattern to it: stock tokens on v4, agent tokens on v2, and the
  // deepest memecoin pools on v3. Quoting a subset is how the bot ended up
  // telling people that tokens with millions in liquidity did not trade.
  async findBestRoute(tokenIn, tokenOut, amountIn) {
    const quotes = await Promise.all(
      Object.entries(this.venues).map(async ([name, venue]) => {
        if (!venue) return null;
        const route = await venue.findBestRoute(tokenIn, tokenOut, amountIn).catch(() => null);
        if (route && !route.venue) route.venue = name;
        return route;
      })
    );
    const found = quotes.filter((route) => route && route.amountOut > 0n);
    if (found.length === 0) return null;
    return found.reduce((best, route) => (route.amountOut > best.amountOut ? route : best));
  }

  async swap(signer, tokenIn, tokenOut, amountIn, options = {}) {
    const route = options.route ?? await this.findBestRoute(tokenIn, tokenOut, amountIn);
    if (!route) throw new Error("no liquidity route found for this pair");
    const venue = this.venues[route.venue] ?? this.v4;
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
