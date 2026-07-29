const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// Resolves the words the bot used in its own advice — "$NVDA", "PEPE", a raw
// contract address — into an exact ERC-20 on Robinhood Chain, via the chain's
// Blockscout token index. Ranking exists because tickers are free to fake:
// the search for NVDA returns the real Robinhood Stock Token AND several
// impersonations with the same symbol. Only the admin-verified token or, for
// memecoins, the one with real market data may win; an ambiguous term fails
// closed and the bot says so instead of buying a scam.
export class AssetResolver {
  constructor({ baseUrl = "https://robinhoodchain.blockscout.com", dexScreenerUrl = "https://api.dexscreener.com", fetchImpl = fetch, logger = console } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.dexScreenerUrl = dexScreenerUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.logger = logger;
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
    // The explorer only knows tokens it has priced, which leaves out anything
    // launched recently — exactly what people ask for. The pair indexers know
    // a token the moment it has liquidity, so they are asked in parallel and
    // whichever finds a real market wins.
    const [fromExplorer, fromPairs] = await Promise.all([
      this.searchExplorer(term).catch(() => null),
      this.searchPairs(term).catch((error) => {
        this.logger.warn?.(`Pair index lookup failed for ${term}: ${error.message}`);
        return null;
      })
    ]);
    // An issuer-verified stock token always wins; otherwise the deepest real
    // pool does, because liquidity is the thing that has to be paid for.
    if (fromExplorer?.official) return fromExplorer;
    if (fromPairs) return fromPairs;
    return fromExplorer;
  }

  // Tokens ranked by the liquidity actually backing their pairs on this chain.
  async searchPairs(term) {
    const response = await this.fetch(`${this.dexScreenerUrl}/latest/dex/search?q=${encodeURIComponent(term)}`, {
      signal: AbortSignal.timeout(6_000)
    });
    if (!response.ok) return null;
    const body = await response.json();
    const matches = (body.pairs ?? [])
      .filter((pair) => String(pair.chainId ?? "").toLowerCase().includes("robinhood"))
      .filter((pair) => String(pair.baseToken?.symbol ?? "").toUpperCase() === term)
      .filter((pair) => Number(pair.liquidity?.usd ?? 0) > 0);
    if (matches.length === 0) return null;

    // One token can have several pairs; sum their liquidity and keep the token
    // with the deepest total, which is the one a buy should route into.
    const byToken = new Map();
    for (const pair of matches) {
      const address = pair.baseToken.address;
      const entry = byToken.get(address) ?? { address, symbol: pair.baseToken.symbol, name: pair.baseToken.name ?? "", liquidityUsd: 0, priceUsd: null };
      entry.liquidityUsd += Number(pair.liquidity.usd);
      entry.priceUsd ??= pair.priceUsd ? Number(pair.priceUsd) : null;
      byToken.set(address, entry);
    }
    const ranked = [...byToken.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    const candidates = ranked.slice(0, 4).map((entry) => ({
      address: entry.address,
      symbol: entry.symbol,
      name: entry.name,
      official: false,
      priceUsd: entry.priceUsd,
      liquidityUsd: entry.liquidityUsd,
      via: "pairs"
    }));
    // A single clearly-deepest pool is not ambiguous; several comparable ones
    // still go to the liquidity vetting downstream.
    return { unverified: true, symbol: term, candidates };
  }

  async searchExplorer(term) {
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

    // No issuer-verified match: hand back the plausible candidates instead of
    // picking one here. Market cap is supply times price and an attacker
    // controls both, so the choice is made against real on-chain liquidity
    // by the caller, which costs money to fake.
    const candidates = pool
      .filter((item) => item.exchange_rate)
      .sort((a, b) => Number(b.circulating_market_cap ?? 0) - Number(a.circulating_market_cap ?? 0))
      .slice(0, 4)
      .map((item) => this.entry(item, false));
    if (candidates.length === 0) return null;
    return { unverified: true, symbol: term, candidates };
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
