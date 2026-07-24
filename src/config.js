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
    databaseUrl: process.env.DATABASE_URL ?? "",
    bots: loadBots()
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
    const botUserId = String(bot.botUserId ?? bot.userId ?? "");
    const userAccessToken = String(bot.userAccessToken ?? "");
    if (!/^[a-z0-9_]{1,15}$/.test(botUsername)) throw new Error("Each bot username must be a valid X username");
    if (usernames.has(botUsername)) throw new Error(`Duplicate bot username: ${botUsername}`);
    usernames.add(botUsername);
    return { botUsername, botUserId, userAccessToken, pollIntervalMs, dryRun };
  });
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
