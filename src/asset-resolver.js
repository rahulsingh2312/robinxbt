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
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
    const value = await this.search(key);
    this.cache.set(key, { value, at: Date.now() });
    return value;
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

    // Only exact symbol matches count. Letting a NAME match answer a ticker
    // query means "NVDA" can resolve to a token called "NVDA Robinhood" whose
    // symbol is something else entirely.
    const pool = tokens.filter((item) => (item.symbol ?? "").toUpperCase() === term);
    if (pool.length === 0) return null;

    // Explorer verification alone is NOT enough: ticker-squatters get admin
    // verified too (a "DOGE" that is not Dogecoin). Official means issued by
    // Robinhood — their tokens all carry the "• Robinhood Token" name suffix
    // and market data.
    const official = pool.find((item) => item.is_verified_via_admin_panel && item.exchange_rate && /• Robinhood Token$/.test(item.name ?? ""));
    if (official) return this.entry(official, true);

    // Everything else fails closed. Market cap is supply times price, and an
    // attacker mints the supply and seeds the pool that sets the price, so
    // ranking unverified tokens by it just hands the ticker to whoever fakes
    // the biggest number. An unverified token must be named by its address.
    return pool.length > 0 ? { unverified: true, symbol: term, count: pool.length } : null;
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
