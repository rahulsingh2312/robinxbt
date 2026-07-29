import { parseBuyIntent, parseUsdAmount } from "./onchain-broker.js";

// People do not phrase orders the way a regular expression expects. "grab me
// a buck fifty of that cat coin", "put twenty on nvidia", "same as before but
// double" — all obvious to a person, all invisible to a pattern. The model
// reads the request; the code decides whether to act on it.
//
// What the model may influence is deliberately narrow: whether this is an
// order, roughly how many dollars, and what the user called the asset. Every
// answer is re-validated here, and the named asset still goes through the
// same resolver, liquidity vetting, and spend caps as any other buy. The
// model can name a token; it can never authorize one.
const SYSTEM_PROMPT = `You read one message sent to a trading bot and report what the sender wants. You never give advice and never write prose.

Return ONLY a JSON object with these keys:
- "action": "buy" if they are telling the bot to purchase something now, "sell" if telling it to sell, "amount_only" if they are just stating a dollar amount (usually answering "how much?"), otherwise "none".
- "asset": the tradable symbol. If they name a company, return its stock ticker ("tesla" -> "TSLA", "apple" -> "AAPL", "nvidia" -> "NVDA", "google" -> "GOOG"). If they name a coin, return it as written without spaces ("cash cat" -> "CASHCAT"). A 0x contract address is returned unchanged. Use null if they did not name anything to trade.
- "amount_usd": the dollar amount as a number, converting words ("a buck fifty" -> 1.5, "twenty bucks" -> 20, "half a dollar" -> 0.5). Use null if no amount is stated.
- "refers_to_context": true if the asset is only identifiable from the conversation (they said "it", "that coin", "the one you mentioned").

Rules:
- Questions are not orders. "should i buy nvda?" and "would you buy $50 of nvda?" are both "none".
- Hypotheticals, jokes, and figures of speech are "none". "grab a coffee, that'll be $5" is "none".
- A currency word is never the asset. In "1.5 dollar of cashcat" the asset is "cashcat".
- Never invent an asset the sender did not mention. Drop trailing words like "stock", "coin", or "token" from the symbol.
- Output the JSON object and nothing else.`;

const MAX_REASONABLE_USD = 1_000_000;

// People say "apple", not "AAPL". The ticker cannot be derived from the word
// by letters alone, and loosening the anti-injection check to allow it would
// let far too much through, so the common names are simply listed. Anything
// not here still has to be justified by the message itself.
const COMPANY_TICKERS = new Map(Object.entries({
  apple: "AAPL", tesla: "TSLA", nvidia: "NVDA", google: "GOOG", alphabet: "GOOG",
  microsoft: "MSFT", amazon: "AMZN", meta: "META", facebook: "META", netflix: "NFLX",
  robinhood: "HOOD", coinbase: "COIN", palantir: "PLTR", amd: "AMD", intel: "INTC",
  broadcom: "AVGO", tsmc: "TSM", walmart: "WMT", disney: "DIS", boeing: "BA",
  starbucks: "SBUX", uber: "UBER", airbnb: "ABNB", spotify: "SPOT", shopify: "SHOP",
  micron: "MU", qualcomm: "QCOM", oracle: "ORCL", salesforce: "CRM", adobe: "ADBE"
}));

export class IntentReader {
  constructor({ llm = null, logger = console, timeoutMs = 12_000 } = {}) {
    this.llm = llm;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }

  // Always returns the same shape as the pattern parser, so callers cannot
  // tell which path produced it.
  async read(text, botUsername, { contextText = null } = {}) {
    const fallback = parseBuyIntent(text, botUsername);
    if (!this.llm?.configured()) return fallback;
    try {
      const parsed = await this.askModel(text, botUsername, contextText);
      if (!parsed) return fallback;
      return this.reconcile(parsed, fallback, text);
    } catch (error) {
      // A model outage must never stop someone from trading; the patterns
      // still handle the common phrasings.
      this.logger.warn("Intent model failed, using pattern parser", error.message);
      return fallback;
    }
  }

  async askModel(text, botUsername, contextText) {
    const cleaned = String(text ?? "").replace(new RegExp(`@${botUsername}\\b`, "ig"), " ").trim();
    if (!cleaned) return null;
    const message = contextText
      ? `Earlier in the conversation: """${String(contextText).slice(0, 400)}"""\n\nTheir message: """${cleaned}"""`
      : `Their message: """${cleaned}"""`;
    const response = await this.llm.complete(
      [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: message }],
      []
    );
    return extractJson(response?.content ?? "");
  }

  // The model's answer is a suggestion, not a decision. Anything it returns
  // that the message itself does not support is dropped.
  reconcile(parsed, fallback, text) {
    const action = String(parsed.action ?? "none").toLowerCase();
    if (action === "sell") return { wantsBuy: false, amountUsd: null, term: null, wantsSell: true };
    if (action !== "buy" && action !== "amount_only") return null;

    let amountUsd = Number(parsed.amount_usd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > MAX_REASONABLE_USD) {
      amountUsd = fallback?.amountUsd ?? null;
    }

    let term = normalizeTerm(parsed.asset);
    // The asset has to appear in what they actually wrote, unless they were
    // pointing at the conversation ("buy it"). Without this a model slip, or
    // an instruction smuggled into a quoted tweet, could name its own token.
    // A company name legitimately produces a ticker that is not in the text
    // ("tesla" -> TSLA), so a short symbol whose letters all appear in the
    // message, in order, counts as derived from it rather than invented.
    // A named company legitimately yields a ticker that shares no letters with
    // it, so a known name in the message vouches for its own ticker.
    const namedCompany = companyTickerIn(text);
    if (term && namedCompany && term === namedCompany) {
      return { wantsBuy: action === "buy", amountUsd, term };
    }
    if (term && !parsed.refers_to_context && !mentions(text, term) && !derivedFrom(text, term)) {
      if (namedCompany) return { wantsBuy: action === "buy", amountUsd, term: namedCompany };
      this.logger.warn(`Intent model proposed "${term}" which is absent from the message; ignoring it`);
      term = fallback?.term ?? null;
    }

    return {
      wantsBuy: action === "buy",
      amountUsd,
      term: term ?? fallback?.term ?? null
    };
  }
}

// Tickers, names, and addresses all arrive as free text; normalize to what the
// resolver expects and refuse anything that is not plausibly an asset name.
function normalizeTerm(value) {
  const raw = String(value ?? "").trim().replace(/^\$/, "");
  if (!raw || raw.toLowerCase() === "null") return null;
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return raw;
  const compact = raw.replace(/\s+/g, "");
  if (!/^[A-Za-z][A-Za-z0-9]{0,14}$/.test(compact)) return null;
  if (/^(usd|dollars?|dollers?|bucks?|money|cash|it|that|this|some)$/i.test(compact)) return null;
  return compact.toUpperCase();
}

// The first well-known company name appearing in the message, as a ticker.
function companyTickerIn(text) {
  const words = String(text).toLowerCase().split(/[^a-z]+/);
  for (const word of words) {
    const ticker = COMPANY_TICKERS.get(word);
    if (ticker) return ticker;
  }
  return null;
}

// Every letter of the symbol appears, in order, inside a single word of the
// message: "tesla" yields TSLA, but an unrelated token cannot be smuggled in.
function derivedFrom(text, term) {
  const symbol = term.toLowerCase();
  if (symbol.length > 5) return false;
  return String(text).toLowerCase().split(/[^a-z]+/).some((word) => {
    if (word.length < symbol.length) return false;
    let index = 0;
    for (const letter of word) if (letter === symbol[index]) index += 1;
    return index === symbol.length;
  });
}

// "cash cat" in the message should satisfy an asset of "cashcat", so both
// sides are compared with whitespace removed.
function mentions(text, term) {
  const haystack = String(text).toLowerCase().replace(/[\s$]/g, "");
  return haystack.includes(term.toLowerCase().replace(/\s/g, ""));
}

// Models wrap JSON in prose or fences no matter how firmly they are told not
// to, so the object is extracted rather than assumed.
function extractJson(content) {
  const text = String(content ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export { parseUsdAmount };
