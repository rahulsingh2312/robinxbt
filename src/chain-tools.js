// Tools that answer "what can I actually buy here", as opposed to "what is
// this ticker worth somewhere in the world".
//
// The bot was quoting global crypto prices and talking about them as if they
// were Robinhood Chain assets. DOGE is the clearest example: the only DOGE on
// this chain is a ticker-squatter with no market, so a post citing DOGE being
// up 0.9% is describing an asset nobody here can buy, in a sentence that
// implies they can. Every number in a reply should come from this chain.

const DEX_SCREENER = "https://api.dexscreener.com";
const QUOTE_SYMBOLS = new Set(["USDG", "WETH", "ETH", "USDC", "USDT"]);

export class ChainTools {
  constructor({ resolver, dex, logger = console, fetchImpl = fetch }) {
    this.resolver = resolver;
    this.dex = dex;
    this.logger = logger;
    this.fetch = fetchImpl;
    this.trendingCache = null;
  }

  // Advertised to the model in the same function-calling shape as the rest.
  definitions() {
    return [
      {
        type: "function",
        function: {
          name: "robinhood_chain_tokens",
          description: "List tokens that actually trade on Robinhood Chain right now, with live price and pool liquidity. Use this before naming any memecoin or on-chain token, and to answer questions about what is available or interesting on the chain.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "robinhood_chain_can_buy",
          description: "Check whether one specific ticker or contract address is buyable on Robinhood Chain, and at what price. Use this before claiming any token is or is not available.",
          parameters: {
            type: "object",
            properties: { symbol: { type: "string", description: "Ticker like NVDA or CASHCAT, or a 0x contract address" } },
            required: ["symbol"]
          }
        }
      }
    ];
  }

  handles(name) {
    return name === "robinhood_chain_tokens" || name === "robinhood_chain_can_buy";
  }

  async run(name, args) {
    if (name === "robinhood_chain_tokens") return this.topTokens();
    if (name === "robinhood_chain_can_buy") return this.canBuy(String(args?.symbol ?? ""));
    return "Error: unknown tool.";
  }

  // The chain's most-traded tokens by real pool liquidity.
  async topTokens() {
    if (this.trendingCache && Date.now() - this.trendingCache.at < 5 * 60_000) return this.trendingCache.value;
    const byToken = new Map();
    for (const query of ["virtuals", "cat", "meme", "robinhood chain", "agent"]) {
      const response = await this.fetch(`${DEX_SCREENER}/latest/dex/search?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(6_000)
      }).catch(() => null);
      if (!response?.ok) continue;
      const body = await response.json();
      for (const pair of body.pairs ?? []) {
        if (!String(pair.chainId ?? "").toLowerCase().includes("robinhood")) continue;
        const token = pair.baseToken;
        const symbol = String(token?.symbol ?? "").toUpperCase();
        if (!symbol || QUOTE_SYMBOLS.has(symbol)) continue;
        const liquidityUsd = Number(pair.liquidity?.usd ?? 0);
        if (liquidityUsd < 5_000) continue;
        const entry = byToken.get(symbol) ?? { symbol, priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null, liquidityUsd: 0, change24h: pair.priceChange?.h24 ?? null, volume24h: 0 };
        entry.liquidityUsd += liquidityUsd;
        entry.volume24h += Number(pair.volume?.h24 ?? 0);
        byToken.set(symbol, entry);
      }
    }
    const ranked = [...byToken.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, 12);
    const value = ranked.length === 0
      ? "No on-chain token data available right now."
      : JSON.stringify({
          note: "Live Robinhood Chain tokens. These are the on-chain assets that actually trade here.",
          tokens: ranked.map((token) => ({
            symbol: token.symbol,
            priceUsd: token.priceUsd,
            change24hPercent: token.change24h,
            liquidityUsd: Math.round(token.liquidityUsd),
            volume24hUsd: Math.round(token.volume24h)
          }))
        });
    this.trendingCache = { value, at: Date.now() };
    return value;
  }

  // Whether a specific thing can be bought, answered by trying to route it.
  async canBuy(symbol) {
    const term = symbol.trim();
    if (!term) return "Error: give a ticker or address.";
    const asset = await this.resolver.resolve(term).catch(() => null);
    if (!asset) {
      return JSON.stringify({ symbol: term, buyable: false, reason: "No token with that ticker trades on Robinhood Chain." });
    }
    const candidates = asset.candidates ?? [asset];
    for (const candidate of candidates) {
      if (!candidate.address) continue;
      const route = await this.dex.findBestRoute("0x0000000000000000000000000000000000000000", candidate.address, 10n ** 15n).catch(() => null);
      if (route) {
        return JSON.stringify({
          symbol: candidate.symbol ?? term,
          buyable: true,
          address: candidate.address,
          priceUsd: candidate.priceUsd ?? null,
          issuerVerified: Boolean(candidate.official),
          venue: route.venue
        });
      }
    }
    return JSON.stringify({
      symbol: term,
      buyable: false,
      reason: "A token with that ticker exists on Robinhood Chain but has no pool to trade against."
    });
  }
}
