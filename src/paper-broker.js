// Simulated fills with the same placeOrder contract as RobinhoodClient, so the
// worker cannot tell paper from live — the mode decision lives in server.js.
// Each X user gets their own book, keyed by author ID.
export class PaperBroker {
  constructor({ store, botUsername, quoteSource = null, logger = console }) {
    this.store = store;
    this.botUsername = botUsername;
    // The real Robinhood client, used only to price fills realistically once
    // it is connected. Without it, notional buys still work (invested dollars
    // are known); share-quantity buys stay refused upstream by RiskLimits.
    this.quoteSource = quoteSource;
    this.logger = logger;
  }

  // Passthrough so worker.estimateCost and the LLM's read tools keep working
  // against live data while orders themselves are simulated.
  call(kind, args) {
    if (!this.quoteSource) return Promise.reject(new Error("No quote source connected"));
    return this.quoteSource.call(kind, args);
  }

  listTools() {
    return this.quoteSource ? this.quoteSource.listTools() : Promise.resolve([]);
  }

  resolveTool(kind) {
    return this.quoteSource ? this.quoteSource.resolveTool(kind) : Promise.reject(new Error("No quote source"));
  }

  callByName(name, args) {
    if (!this.quoteSource) return Promise.reject(new Error("No quote source connected"));
    return this.quoteSource.callByName(name, args);
  }

  async placeOrder({ side, symbol, quantity, notionalUsd, userId = "shared" }) {
    const price = await this.price(symbol);
    const book = (await this.store.getPaperBook(this.botUsername, userId)) ?? { positions: {}, trades: [] };
    const position = book.positions[symbol] ?? { investedUsd: 0, shares: 0 };

    let costUsd;
    let shares;
    if (side === "buy") {
      costUsd = notionalUsd ?? (price ? quantity * price : null);
      if (costUsd === null) throw new Error("Cannot price this order without a live quote");
      shares = price ? (quantity ?? costUsd / price) : null;
      position.investedUsd += costUsd;
      if (shares !== null && position.shares !== null) position.shares += shares;
      else position.shares = null; // one unpriced lot makes share count unknowable
    } else {
      // Sells reduce the position; proceeds price from the live quote when
      // available, else dollar-for-dollar against invested.
      costUsd = notionalUsd ?? (price ? quantity * price : null);
      if (costUsd === null) throw new Error("Cannot price this order without a live quote");
      const reduction = Math.min(costUsd, position.investedUsd);
      position.investedUsd -= reduction;
      if (price && quantity && position.shares !== null) position.shares = Math.max(0, position.shares - quantity);
    }

    if (position.investedUsd <= 0.005 && !position.shares) delete book.positions[symbol];
    else book.positions[symbol] = position;
    book.trades.push({ side, symbol, quantity: quantity ?? null, notionalUsd: notionalUsd ?? null, priceUsd: price, at: new Date().toISOString() });
    if (book.trades.length > 200) book.trades = book.trades.slice(-200);
    await this.store.setPaperBook(this.botUsername, userId, book);

    const at = price ? ` @ $${price.toFixed(2)}` : " @ market";
    return { name: "paper", text: `Paper ${side}${at}`, structured: { paper: true, side, symbol, costUsd, priceUsd: price } };
  }

  async price(symbol) {
    if (!this.quoteSource) return null;
    try {
      const quote = await this.quoteSource.call("quote", { symbol });
      const candidate = quote.structured ?? {};
      for (const key of ["price", "last_price", "lastPrice", "ask_price", "mark_price"]) {
        const value = Number(candidate[key]);
        if (Number.isFinite(value) && value > 0) return value;
      }
      const match = String(quote.text ?? "").match(/\$?\s*([\d,]+\.\d{2})\b/);
      if (match) {
        const value = Number(match[1].replace(/,/g, ""));
        if (Number.isFinite(value) && value > 0) return value;
      }
    } catch (error) {
      this.logger.warn(`Paper pricing failed for ${symbol}`, error.message);
    }
    return null;
  }
}

export function describeBook(book) {
  const symbols = Object.entries(book?.positions ?? {});
  if (symbols.length === 0) return null;
  const total = symbols.reduce((sum, [, position]) => sum + position.investedUsd, 0);
  const parts = symbols
    .sort(([, a], [, b]) => b.investedUsd - a.investedUsd)
    .slice(0, 6)
    .map(([symbol, position]) => `$${symbol} $${Math.round(position.investedUsd)}`);
  return `Paper book: ${parts.join(" · ")} — $${Math.round(total)} in.`;
}
