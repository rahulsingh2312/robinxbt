import path from "node:path";

export function loadConfig() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  return {
    port,
    publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
    dataFile: path.resolve(process.env.DATA_FILE ?? "./data/store.json"),
    adminApiKey: process.env.ADMIN_API_KEY ?? "",
    // App-only bearer. Cannot post or read mentions in user context, but it is
    // exactly what the filtered stream and webhook management endpoints want.
    appBearerToken: process.env.X_APP_BEARER_TOKEN ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    bots: loadBots(),
    trading: loadTrading(),
    insiders: {
      baseUrl: process.env.AGENT_BASE_URL ?? "https://agent.insiders.bot",
      jwtSecret: process.env.INSIDERS_JWT_SECRET ?? "",
      userId: process.env.INSIDERS_USER_ID ?? "",
      // Every agent turn burns credits, so free-form answers are opt-in.
      enabled: process.env.INSIDERS_ENABLED === "true"
    },
    llm: {
      enabled: process.env.LLM_ENABLED === "true",
      baseUrl: process.env.LLM_BASE_URL ?? "https://api.deepseek.com",
      apiKey: process.env.LLM_API_KEY ?? "",
      model: process.env.LLM_MODEL_NAME ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
      reasoningEffort: process.env.LLM_REASONING_EFFORT ?? "low"
    },
    persona: loadPersona(),
    replyCaps: loadReplyCaps(),
    // Reply chains to read for context. Hop one is free (X expands it with
    // the mention); each further hop is a billed read.
    contextDepth: Math.min(Math.max(Number(process.env.CONTEXT_THREAD_DEPTH ?? 3), 1), 6),
    onchain: loadOnchain()
  };
}

// Per-user custodial wallets on Robinhood Chain. Everything here is opt-in:
// with ONCHAIN_ENABLED unset the bot behaves exactly as before.
// A 64-char hex string can still be worthless as a key. Reject the shapes a
// human actually produces by accident: repeated characters, all zeroes, or
// too few distinct bytes to be random.
function assertStrongHexKey(hex, name) {
  const bytes = Buffer.from(hex, "hex");
  const distinct = new Set(bytes).size;
  if (distinct < 12) {
    throw new Error(`${name} looks like a placeholder, not a random key (only ${distinct} distinct bytes). Generate one with \`openssl rand -hex 32\`.`);
  }
}

function loadOnchain() {
  const enabled = process.env.ONCHAIN_ENABLED === "true";
  const walletEncKey = process.env.WALLET_ENC_KEY ?? "";
  const previousWalletEncKey = process.env.WALLET_ENC_KEY_PREVIOUS ?? "";
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  // Refused at startup: generating wallets that cannot be encrypted, or
  // encrypting with a weak key, silently loses user money later.
  if (enabled && !/^[0-9a-fA-F]{64}$/.test(walletEncKey)) {
    throw new Error("ONCHAIN_ENABLED=true requires WALLET_ENC_KEY: 64 hex chars, e.g. from `openssl rand -hex 32`");
  }
  // Hex shape alone does not make a key: a doc placeholder like "aaaa…" is
  // 64 valid characters and about 4 bits of entropy.
  if (enabled) assertStrongHexKey(walletEncKey, "WALLET_ENC_KEY");
  if (previousWalletEncKey) assertStrongHexKey(previousWalletEncKey, "WALLET_ENC_KEY_PREVIOUS");
  // This secret alone gates key export, so a guessable one is equivalent to
  // publishing every wallet. Unset is fine (it derives from the wallet key);
  // set-but-weak is not.
  if (enabled && sessionSecret && Buffer.from(sessionSecret, "utf8").length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes; generate with `openssl rand -hex 32`, or leave it unset to derive one from WALLET_ENC_KEY");
  }
  const maxOrderUsd = Number(process.env.ONCHAIN_MAX_ORDER_USD ?? 100);
  const gasReserveEth = Number(process.env.ONCHAIN_GAS_RESERVE_ETH ?? 0.0002);
  // Slippage and impact are tiered, because one number cannot serve both a
  // stock token that round-trips at 99.9% and a memecoin where a $20 trade
  // legitimately moves the price. Verified issuer tokens get tight bounds
  // (loose ones would only ever be exploited); unverified tokens get enough
  // room to fill, with the honesty of a warning in the reply.
  const slippageBps = Number(process.env.ONCHAIN_SLIPPAGE_BPS ?? 50);
  const maxSlippageBps = Number(process.env.ONCHAIN_MAX_SLIPPAGE_BPS ?? 500);
  const maxPriceImpactBps = Number(process.env.ONCHAIN_MAX_PRICE_IMPACT_BPS ?? 150);
  // Deliberately wide: an unverified token is a memecoin, and paying tens of
  // percent to get into a thin pool is a normal outcome there rather than a
  // sign of anything wrong. Verified issuer tokens keep the tight budget,
  // where a large impact really would mean something is broken.
  const maxPriceImpactUnverifiedBps = Number(process.env.ONCHAIN_MAX_PRICE_IMPACT_UNVERIFIED_BPS ?? 5000);
  if (!Number.isFinite(maxOrderUsd) || maxOrderUsd <= 0) throw new Error("ONCHAIN_MAX_ORDER_USD must be a positive number");
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 3000) throw new Error("ONCHAIN_SLIPPAGE_BPS must be an integer between 1 and 3000");
  if (!Number.isInteger(maxSlippageBps) || maxSlippageBps < slippageBps || maxSlippageBps > 3000) throw new Error("ONCHAIN_MAX_SLIPPAGE_BPS must be an integer between ONCHAIN_SLIPPAGE_BPS and 3000");
  if (!Number.isInteger(maxPriceImpactUnverifiedBps) || maxPriceImpactUnverifiedBps < maxPriceImpactBps || maxPriceImpactUnverifiedBps > 10000) throw new Error("ONCHAIN_MAX_PRICE_IMPACT_UNVERIFIED_BPS must be between ONCHAIN_MAX_PRICE_IMPACT_BPS and 10000");
  if (!Number.isFinite(gasReserveEth) || gasReserveEth < 0) throw new Error("ONCHAIN_GAS_RESERVE_ETH must be >= 0");
  if (!Number.isInteger(maxPriceImpactBps) || maxPriceImpactBps < 10 || maxPriceImpactBps > 10000) throw new Error("ONCHAIN_MAX_PRICE_IMPACT_BPS must be an integer between 10 and 10000");
  return {
    enabled,
    walletEncKey,
    previousWalletEncKey,
    rpcUrl: process.env.ROBINHOOD_CHAIN_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
    blockscoutBaseUrl: process.env.ROBINHOOD_CHAIN_EXPLORER ?? "https://robinhoodchain.blockscout.com",
    maxOrderUsd,
    slippageBps,
    gasReserveEth,
    maxSlippageBps,
    maxPriceImpactBps,
    maxPriceImpactUnverifiedBps,
    // Funding replies carry the deposit address so someone can top up without
    // leaving the conversation. X refuses posts containing an address for the
    // first week after an app authenticates, and the worker falls back to
    // pointing at the portfolio page when that happens, so this stays on.
    addressInReplies: process.env.ONCHAIN_ADDRESS_IN_REPLIES !== "false",
    // The Next.js site proxies /auth and /api to this server, so the OAuth
    // redirect URI must be built from the SITE's origin, not this server's.
    siteBaseUrl: (process.env.SITE_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, ""),
    oauth: {
      clientId: process.env.X_CLIENT_ID ?? "",
      clientSecret: process.env.X_CLIENT_SECRET ?? ""
    },
    sessionSecret,
    // Shared with the site's proxy. When set, the wallet API refuses any
    // request that did not come through the site, which also makes the
    // forwarded client IP trustworthy for rate limiting.
    proxySecret: process.env.PROXY_SHARED_SECRET ?? ""
  };
}

// Replies cost money on X and another bot answering ours would otherwise loop
// without bound, so both a per-author and a per-day ceiling are always on.
function loadReplyCaps() {
  const perAuthorPerHour = Number(process.env.REPLY_MAX_PER_AUTHOR_PER_HOUR ?? 5);
  const perDay = Number(process.env.REPLY_MAX_PER_DAY ?? 200);
  if (!Number.isFinite(perAuthorPerHour) || perAuthorPerHour < 1) throw new Error("REPLY_MAX_PER_AUTHOR_PER_HOUR must be at least 1");
  if (!Number.isFinite(perDay) || perDay < 1) throw new Error("REPLY_MAX_PER_DAY must be at least 1");
  return { perAuthorPerHour, perDay };
}

function loadPersona() {
  const name = (process.env.PERSONA ?? "default").toLowerCase();
  if (!["default", "gork"].includes(name)) {
    throw new Error(`PERSONA must be "default" or "gork", got "${name}"`);
  }
  const minMinutes = Number(process.env.GORK_POST_MIN_MINUTES ?? 120);
  const maxMinutes = Number(process.env.GORK_POST_MAX_MINUTES ?? 360);
  if (!Number.isFinite(minMinutes) || minMinutes < 1) throw new Error("GORK_POST_MIN_MINUTES must be at least 1");
  if (!Number.isFinite(maxMinutes) || maxMinutes < minMinutes) {
    throw new Error("GORK_POST_MAX_MINUTES must be >= GORK_POST_MIN_MINUTES");
  }
  return {
    name,
    posting: {
      // Unprompted posts spend real money per post; opt-in like everything
      // else that talks to the outside world.
      enabled: process.env.GORK_POSTING_ENABLED === "true",
      minIntervalMs: minMinutes * 60_000,
      maxIntervalMs: maxMinutes * 60_000
    },
    corpus: {
      // Numeric X user ID of the public figure whose voice the parody tracks.
      userId: process.env.CORPUS_X_USER_ID ?? "",
      maxPosts: Number(process.env.CORPUS_MAX_POSTS ?? 15),
      refreshMs: Number(process.env.CORPUS_REFRESH_HOURS ?? 12) * 60 * 60 * 1000
    }
  };
}

function loadTrading() {
  const enabled = process.env.TRADING_ENABLED === "true";
  // Paper unless the operator explicitly asks for live: simulated fills are
  // the default failure mode, not real money.
  const mode = process.env.TRADING_MODE === "live" ? "live" : "paper";
  const allowedAuthorIds = (process.env.X_TRADE_AUTHOR_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const maxOrderUsd = Number(process.env.MAX_ORDER_USD ?? 100);
  const dailyMaxUsd = Number(process.env.DAILY_MAX_USD ?? 500);
  if (!Number.isFinite(maxOrderUsd) || maxOrderUsd <= 0) throw new Error("MAX_ORDER_USD must be a positive number");
  if (!Number.isFinite(dailyMaxUsd) || dailyMaxUsd <= 0) throw new Error("DAILY_MAX_USD must be a positive number");
  // An empty allowlist with trading on would let any stranger spend the
  // operator's money, so it is refused at startup rather than at runtime.
  if (enabled && allowedAuthorIds.length === 0) {
    throw new Error("TRADING_ENABLED=true requires X_TRADE_AUTHOR_IDS with at least one numeric X user ID");
  }
  return {
    enabled,
    mode,
    allowedAuthorIds,
    maxOrderUsd,
    dailyMaxUsd,
    tokenFile: path.resolve(process.env.ROBINHOOD_TOKEN_FILE ?? "./data/robinhood-tokens.json"),
    callbackPort: Number(process.env.ROBINHOOD_CALLBACK_PORT ?? 41999),
    clientId: process.env.ROBINHOOD_CLIENT_ID ?? "",
    clientSecret: process.env.ROBINHOOD_CLIENT_SECRET ?? "",
    toolOverrides: {
      placeOrder: process.env.ROBINHOOD_TOOL_PLACEORDER ?? "",
      quote: process.env.ROBINHOOD_TOOL_QUOTE ?? "",
      positions: process.env.ROBINHOOD_TOOL_POSITIONS ?? "",
      account: process.env.ROBINHOOD_TOOL_ACCOUNT ?? ""
    }
  };
}

function loadBots() {
  const pollIntervalMs = Number(process.env.X_POLL_INTERVAL_MS ?? 30_000);
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1_000) {
    throw new Error("X_POLL_INTERVAL_MS must be at least 1000");
  }
  const dryRun = process.env.X_DRY_RUN !== "false";
  const configuredBots = process.env.X_BOTS_JSON
    ? parseBots(process.env.X_BOTS_JSON)
    : [{
        botUserId: process.env.X_BOT_USER_ID ?? "",
        botUsername: process.env.X_BOT_USERNAME ?? "yourbot",
        userAccessToken: process.env.X_BOT_USER_ACCESS_TOKEN ?? ""
      }];
  const usernames = new Set();
  return configuredBots.map((bot) => {
    const botUsername = String(bot.botUsername ?? bot.username ?? "").replace(/^@/, "").toLowerCase();
    const userAccessToken = String(bot.userAccessToken ?? "");
    const oauth1 = loadOauth1(bot);
    const botUserId = resolveBotUserId(String(bot.botUserId ?? bot.userId ?? ""), oauth1, botUsername);
    if (!/^[a-z0-9_]{1,15}$/.test(botUsername)) throw new Error("Each bot username must be a valid X username");
    if (usernames.has(botUsername)) throw new Error(`Duplicate bot username: ${botUsername}`);
    usernames.add(botUsername);
    return { botUsername, botUserId, userAccessToken, oauth1, pollIntervalMs, dryRun };
  });
}

// An OAuth 1.0a access token is prefixed with the numeric ID of the account
// that authorized it, so the bot's user ID never has to be configured by hand.
// Configuring it separately only creates a way for the two to disagree, which
// would silently poll one account's mentions while replying as another.
function resolveBotUserId(configured, oauth1, botUsername) {
  const fromToken = oauth1?.accessToken.match(/^(\d+)-/)?.[1] ?? "";
  if (configured && fromToken && configured !== fromToken) {
    throw new Error(
      `X_BOT_USER_ID (${configured}) does not match the account that owns X_ACCESS_TOKEN (${fromToken}). ` +
      `The token belongs to a different account than @${botUsername}; replies would come from the wrong handle.`
    );
  }
  return configured || fromToken;
}

// All four values must be present together; a partial set is a misconfiguration
// that would otherwise fail as an opaque 401 from X.
function loadOauth1(bot) {
  const credentials = {
    consumerKey: bot.consumerKey ?? process.env.X_CONSUMER_KEY ?? "",
    consumerSecret: bot.consumerSecret ?? process.env.X_CONSUMER_SECRET ?? "",
    accessToken: bot.accessToken ?? process.env.X_ACCESS_TOKEN ?? "",
    accessTokenSecret: bot.accessTokenSecret ?? process.env.X_ACCESS_TOKEN_SECRET ?? ""
  };
  const present = Object.values(credentials).filter(Boolean).length;
  if (present === 0) return null;
  if (present < 4) throw new Error("OAuth 1.0a needs consumer key, consumer secret, access token, and access token secret");
  return credentials;
}

function parseBots(value) {
  try {
    const bots = JSON.parse(value);
    if (!Array.isArray(bots) || bots.length === 0) throw new Error();
    return bots;
  } catch {
    throw new Error("X_BOTS_JSON must be a non-empty JSON array");
  }
}
