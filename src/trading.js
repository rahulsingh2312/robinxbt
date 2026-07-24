const SYMBOL = /^[A-Z]{1,5}$/;

// Deliberately strict. With instant execution there is no confirmation step to
// catch a bad parse, so anything ambiguous must fail closed rather than guess.
export function parseOrder(text, botUsername) {
  const command = text
    .replace(new RegExp(`@${botUsername}\\b`, "ig"), " ")
    .replace(/[“”"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const match = command.match(
    /\b(buy|sell)\b\s+(?:\$\s?([\d,]+(?:\.\d+)?)\s*(?:worth\s+)?(?:of\s+)?|([\d,]+(?:\.\d+)?)\s*(?:shares?\s+)?(?:of\s+)?)?\$?([A-Za-z]{1,5})\b/i
  );
  if (!match) return null;

  const [, rawSide, rawNotional, rawQuantity, rawSymbol] = match;
  const symbol = rawSymbol.toUpperCase();
  if (!SYMBOL.test(symbol)) return null;
  // Without a quantity or a dollar amount the intent is unknowable.
  if (!rawNotional && !rawQuantity) return null;

  const order = { side: rawSide.toLowerCase(), symbol };
  if (rawNotional) {
    order.notionalUsd = Number(rawNotional.replace(/,/g, ""));
    if (!Number.isFinite(order.notionalUsd) || order.notionalUsd <= 0) return null;
  } else {
    order.quantity = Number(rawQuantity.replace(/,/g, ""));
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) return null;
  }
  return order;
}

export function looksLikeTrade(text) {
  return /\b(buy|sell|swap|trade|long|short)\b/i.test(text);
}

export class RiskLimits {
  constructor({ allowedAuthorIds, maxOrderUsd, dailyMaxUsd }) {
    this.allowedAuthorIds = new Set(allowedAuthorIds);
    this.maxOrderUsd = maxOrderUsd;
    this.dailyMaxUsd = dailyMaxUsd;
  }

  // Authorization is by numeric author ID, never by handle: handles can be
  // changed and a released handle can be re-registered by someone else.
  authorizes(authorId) {
    return this.allowedAuthorIds.has(String(authorId));
  }

  // A share-quantity order has no known cost until it is priced, so it is only
  // allowed when the caller supplies an estimate.
  check(order, { spentTodayUsd, estimatedUsd }) {
    if (order.side === "sell") return { ok: true, estimatedUsd: estimatedUsd ?? 0 };
    const cost = order.notionalUsd ?? estimatedUsd;
    if (cost === undefined || cost === null || !Number.isFinite(cost)) {
      return { ok: false, reason: "could not price this order, so it was not sent" };
    }
    if (cost > this.maxOrderUsd) {
      return { ok: false, reason: `order is $${round(cost)} and the per-order cap is $${round(this.maxOrderUsd)}` };
    }
    if (spentTodayUsd + cost > this.dailyMaxUsd) {
      return { ok: false, reason: `daily cap of $${round(this.dailyMaxUsd)} would be exceeded ($${round(spentTodayUsd)} used today)` };
    }
    return { ok: true, estimatedUsd: cost };
  }
}

function round(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
