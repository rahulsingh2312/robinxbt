// Free live quotes for stocks and crypto, shaped like the Robinhood broker's
// read tools so the LLM and the paper broker cannot tell the difference. Used
// when no Robinhood session exists; once robinhood:login has been run, the
// real client takes over and this class is not constructed at all.
const CRYPTO = {
  BTC: "bitcoin",
  ETH: "ethereum",
  DOGE: "dogecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  LTC: "litecoin",
  SHIB: "shiba-inu",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  BCH: "bitcoin-cash",
  UNI: "uniswap",
  PEPE: "pepe",
  TRX: "tron"
};

const QUOTE_TOOL = {
  name: "get_quote",
  description: "Live quote for a stock or crypto symbol: price in USD plus percent change. Works for equities and ETFs (NVDA, SPY) and major tokens (BTC, DOGE).",
  inputSchema: {
    type: "object",
    properties: { symbol: { type: "string", description: "Ticker symbol, e.g. NVDA or BTC" } },
    required: ["symbol"]
  }
};

export class MarketData {
  constructor({ fetcher = fetch, cacheMs = 60_000, logger = console } = {}) {
    this.fetcher = fetcher;
    // Mention bursts would otherwise hammer the free endpoints into a 429;
    // one minute of staleness is invisible in a tweet.
    this.cacheMs = cacheMs;
    this.logger = logger;
    this.cache = new Map();
  }

  async listTools() {
    return [QUOTE_TOOL];
  }

  async callByName(name, args) {
    if (name !== QUOTE_TOOL.name) throw new Error(`Unknown tool: ${name}`);
    return this.quote(String(args?.symbol ?? "").toUpperCase().replace(/^\$/, ""));
  }

  // The worker and paper broker ask by kind; "quote" is the only kind here.
  async call(kind, args) {
    if (kind !== "quote") throw new Error(`Market data has no "${kind}" tool`);
    return this.callByName(QUOTE_TOOL.name, args);
  }

  resolveTool(kind) {
    if (kind === "quote") return Promise.resolve(QUOTE_TOOL.name);
    return Promise.reject(new Error(`Market data has no "${kind}" tool`));
  }

  async quote(symbol) {
    if (!/^[A-Z.^-]{1,10}$/.test(symbol)) throw new Error(`Not a symbol: ${symbol}`);
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.at < this.cacheMs) return cached.result;

    const result = CRYPTO[symbol] ? await this.crypto(symbol) : await this.stock(symbol);
    this.cache.set(symbol, { at: Date.now(), result });
    return result;
  }

  async stock(symbol) {
    try {
      return await this.yahoo(symbol);
    } catch (error) {
      this.logger.warn(`Yahoo quote failed for ${symbol}: ${error.message}`);
      return this.stooq(symbol);
    }
  }

  async yahoo(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    // Yahoo rejects requests without a browser-looking user agent.
    const response = await this.fetcher(url, {
      headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64)" },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const meta = (await response.json())?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error("no price in response");
    const previous = Number(meta?.chartPreviousClose ?? meta?.previousClose);
    const changePercent = Number.isFinite(previous) && previous > 0 ? ((price - previous) / previous) * 100 : null;
    return this.shape(symbol, price, changePercent, "yahoo");
  }

  async stooq(symbol) {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&f=sd2t2ohlcv&e=csv`;
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Stooq HTTP ${response.status}`);
    // CSV: Symbol,Date,Time,Open,High,Low,Close,Volume — "N/D" when unknown.
    const close = Number((await response.text()).trim().split("\n")[1]?.split(",")[6]);
    if (!Number.isFinite(close) || close <= 0) throw new Error(`No quote for ${symbol}`);
    return this.shape(symbol, close, null, "stooq");
  }

  async crypto(symbol) {
    try {
      const id = CRYPTO[symbol];
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`;
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const entry = (await response.json())?.[id];
      const price = Number(entry?.usd);
      if (!Number.isFinite(price) || price <= 0) throw new Error("no price in response");
      const change = Number(entry?.usd_24h_change);
      return this.shape(symbol, price, Number.isFinite(change) ? change : null, "coingecko");
    } catch (error) {
      this.logger.warn(`CoinGecko quote failed for ${symbol}: ${error.message}`);
      const response = await this.fetcher(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`Coinbase HTTP ${response.status}`);
      const price = Number((await response.json())?.data?.amount);
      if (!Number.isFinite(price) || price <= 0) throw new Error(`No quote for ${symbol}`);
      return this.shape(symbol, price, null, "coinbase");
    }
  }

  shape(symbol, price, changePercent, source) {
    const move = changePercent === null ? "" : ` (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}% ${CRYPTO[symbol] ? "24h" : "today"})`;
    return {
      text: `${symbol} $${price.toLocaleString("en-US", { maximumFractionDigits: price < 1 ? 6 : 2 })}${move}`,
      structured: { symbol, price, changePercent, source }
    };
  }
}
