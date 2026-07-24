const SYMBOL = /^[A-Z0-9._-]{1,15}$/;

export function normalizePortfolio(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("portfolio must be an object");
  }
  if (!Array.isArray(input.holdings) || input.holdings.length === 0 || input.holdings.length > 50) {
    throw new Error("holdings must contain between 1 and 50 items");
  }

  const totalValueUsd = number(input.totalValueUsd, "totalValueUsd", 0);
  const holdings = input.holdings.map((holding) => ({
    symbol: text(holding.symbol, "holding.symbol").toUpperCase(),
    name: optionalText(holding.name, "holding.name"),
    quantity: number(holding.quantity, "holding.quantity", 0),
    valueUsd: number(holding.valueUsd, "holding.valueUsd", 0)
  }));
  for (const holding of holdings) {
    if (!SYMBOL.test(holding.symbol)) throw new Error("holding.symbol contains unsupported characters");
  }
  return {
    holdings: holdings.sort((first, second) => second.valueUsd - first.valueUsd),
    totalValueUsd,
    hideValues: Boolean(input.hideValues),
    updatedAt: new Date().toISOString()
  };
}

function text(value, field) {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 80) {
    throw new Error(`${field} must be a non-empty string up to 80 characters`);
  }
  return value.trim();
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return text(value, field);
}

function number(value, field, minimum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${field} must be a finite number greater than or equal to ${minimum}`);
  }
  return value;
}

export function publicSummary(user) {
  const { portfolio } = user;
  if (!portfolio) return null;
  return portfolio.holdings.slice(0, 3).map((holding) => holding.symbol).join(" · ");
}
