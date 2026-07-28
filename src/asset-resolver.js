const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// Resolves the words the bot used in its own advice — "$NVDA", "PEPE", a raw
// contract address — into an exact ERC-20 on Robinhood Chain, via the chain's
// Blockscout token index. Ranking exists because tickers are free to fake:
// the search for NVDA returns the real Robinhood Stock Token AND several
// impersonations with the same symbol. Only the admin-verified token or, for
// memecoins, the one with real market data may win; an ambiguous term fails
// closed and the bot says so instead of buying a scam.
export class AssetResolver {
  constructor({ baseUrl = "https://robinhoodchain.blockscout.com", fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  async resolve(term) {
    const cleaned = String(term ?? "").trim().replace(/^\$/, "");
    if (!cleaned) return null;
    if (ADDRESS.test(cleaned)) return this.byAddress(cleaned);
    const key = cleaned.toUpperCase();
    if (!this.cache.has(key)) this.cache.set(key, await this.search(key));
    return this.cache.get(key);
  }

  async byAddress(address) {
    const response = await this.fetch(`${this.baseUrl}/api/v2/tokens/${address}`);
    if (!response.ok) return null;
    const token = await response.json();
    if (token.type !== "ERC-20") return null;
    return {
      address,
      symbol: token.symbol ?? "?",
      name: token.name ?? "",
      official: false,
      priceUsd: token.exchange_rate ? Number(token.exchange_rate) : null,
      via: "address"
    };
  }

  async search(term) {
    const response = await this.fetch(`${this.baseUrl}/api/v2/search?q=${encodeURIComponent(term)}`);
    if (!response.ok) return null;
    const body = await response.json();
    const tokens = (body.items ?? []).filter((item) => item.type === "token" && item.token_type === "ERC-20");
    if (tokens.length === 0) return null;

    const symbolMatches = tokens.filter((item) => (item.symbol ?? "").toUpperCase() === term);
    const pool = symbolMatches.length > 0 ? symbolMatches : tokens;

    // Explorer verification alone is NOT enough: ticker-squatters get admin
    // verified too (a "DOGE" that is not Dogecoin). Official means issued by
    // Robinhood — their tokens all carry the "• Robinhood Token" name suffix
    // and market data.
    const official = pool.find((item) => item.is_verified_via_admin_panel && item.exchange_rate && /• Robinhood Token$/.test(item.name ?? ""));
    if (official) return this.entry(official, true);

    // Memecoins are unverified by nature. Priced-with-market-cap is the bar:
    // it means an indexed pool with actual liquidity, not a freshly minted
    // impersonation. More than one plausible candidate means we cannot know
    // which one the user wants, so nothing is bought.
    const traded = pool.filter((item) => item.exchange_rate && item.circulating_market_cap);
    if (traded.length === 1) return this.entry(traded[0], false);
    if (traded.length > 1) {
      const [best, second] = [...traded].sort((a, b) => Number(b.circulating_market_cap) - Number(a.circulating_market_cap));
      // A 10x market-cap gap treats the leader as the obvious answer.
      if (Number(best.circulating_market_cap) >= 10 * Number(second.circulating_market_cap)) return this.entry(best, false);
      return { ambiguous: true, count: traded.length };
    }
    return null;
  }

  entry(item, official) {
    return {
      address: item.address_hash ?? item.address,
      symbol: item.symbol,
      name: item.name,
      official,
      priceUsd: item.exchange_rate ? Number(item.exchange_rate) : null,
      via: "search"
    };
  }
}

// Pulls candidate asset terms out of a piece of text, most-specific first:
// contract addresses, then $cashtags, then bare uppercase ticker-shaped words.
export function extractAssetTerms(text, limit = 4) {
  const source = String(text ?? "");
  const addresses = [...source.matchAll(/\b(0x[0-9a-fA-F]{40})\b/g)].map((match) => match[1]);
  const cashtags = [...source.matchAll(/\$([A-Za-z][A-Za-z0-9]{0,14})\b/g)].map((match) => match[1].toUpperCase());
  const bare = [...source.matchAll(/\b([A-Z]{2,10})\b/g)].map((match) => match[1]);
  const junk = new Set(["I", "A", "THE", "AND", "OR", "IF", "IT", "IS", "BUY", "SELL", "USD", "USDG", "ETH", "ETF", "CEO", "AI", "US", "OK", "YES", "NO", "PE", "EPS", "IPO", "DYOR", "NFA", "LFG", "CA", "DM", "RT"]);
  const ordered = [...addresses, ...cashtags.filter((term) => !junk.has(term)), ...bare.filter((term) => !junk.has(term))];
  return [...new Set(ordered)].slice(0, limit);
}
