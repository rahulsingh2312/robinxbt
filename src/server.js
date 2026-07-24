import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { MentionWorker } from "./mention-worker.js";
import { normalizePortfolio } from "./portfolio.js";
import { Store } from "./store.js";
import { PostgresStore } from "./postgres-store.js";
import { XClient } from "./x-client.js";

const config = loadConfig();
const store = config.databaseUrl ? new PostgresStore(config.databaseUrl) : new Store(config.dataFile);
await store.load();
const workers = config.bots.map((bot) => new MentionWorker({ store, client: new XClient(bot), bot, publicBaseUrl: config.publicBaseUrl }));

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode ?? 500, { error: error.message ?? "Internal server error" });
  }
});

server.listen(config.port, () => {
  console.info(`xbot listening on ${config.publicBaseUrl}`);
  workers.forEach((worker) => worker.start());
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    workers.forEach((worker) => worker.stop());
    server.close(async () => {
      await store.close?.();
      process.exit(0);
    });
  });
}

async function route(request, response) {
  const url = new URL(request.url, config.publicBaseUrl);
  if (request.method === "GET" && url.pathname === "/health") return sendJson(response, 200, { ok: true, database: config.databaseUrl ? "postgres" : "json", bots: config.bots.map((bot, index) => ({ username: bot.botUsername, xPolling: workers[index].client.configured(), dryRun: bot.dryRun })) });
  if (request.method === "GET" && url.pathname === "/setup") return sendHtml(response, 200, setupPage());
  if (request.method === "GET" && url.pathname.startsWith("/p/")) return publicPortfolio(response, url.pathname);
  if (request.method === "POST" && url.pathname.startsWith("/api/bots/") && url.pathname.endsWith("/users")) return provisionUser(request, response, routeParts(url.pathname, 4)[2]);
  if (request.method === "PUT" && url.pathname.startsWith("/api/bots/") && url.pathname.includes("/users/")) return updateUser(request, response, routeParts(url.pathname, 6)[2], routeParts(url.pathname, 6)[4]);
  sendJson(response, 404, { error: "Not found" });
}

async function provisionUser(request, response, rawBotUsername) {
  requireAdmin(request);
  const body = await readJson(request);
  const botUsername = botUsernameFrom(rawBotUsername);
  const xUsername = username(body.xUsername);
  if (await store.getUser(botUsername, xUsername)) throw httpError(409, "This X username is already provisioned for this bot");
  const ownerToken = randomBytes(32).toString("base64url");
  await store.setUser(botUsername, xUsername, {
    botUsername,
    xUsername,
    displayName: safeName(body.displayName) ?? `@${xUsername}`,
    ownerTokenHash: hash(ownerToken),
    publicSharing: false,
    portfolio: null,
    createdAt: new Date().toISOString()
  });
  sendJson(response, 201, { botUsername, xUsername, ownerToken, warning: "Store this token now; it is not shown again." });
}

async function updateUser(request, response, rawBotUsername, rawUsername) {
  const botUsername = botUsernameFrom(rawBotUsername);
  const xUsername = username(rawUsername);
  const user = await store.getUser(botUsername, xUsername);
  if (!user) throw httpError(404, "User not found");
  requireOwner(request, user);
  const body = await readJson(request);
  if (body.publicSharing !== undefined) user.publicSharing = Boolean(body.publicSharing);
  if (body.displayName !== undefined) user.displayName = safeName(body.displayName) ?? user.displayName;
  if (body.portfolio !== undefined) user.portfolio = normalizePortfolio(body.portfolio);
  await store.setUser(botUsername, xUsername, user);
  sendJson(response, 200, { botUsername, xUsername, publicSharing: user.publicSharing, publicUrl: `${config.publicBaseUrl}/p/${encodeURIComponent(botUsername)}/${encodeURIComponent(xUsername)}` });
}

async function publicPortfolio(response, pathname) {
  const parts = routeParts(pathname, 3);
  if (parts.length !== 3) return sendHtml(response, 404, notFoundPage());
  const botUsername = botUsernameFrom(parts[1]);
  const user = await store.getUser(botUsername, username(parts[2]));
  if (!user?.publicSharing || !user.portfolio) return sendHtml(response, 404, notFoundPage());
  return sendHtml(response, 200, portfolioPage(user));
}

function botUsernameFrom(value) {
  const botUsername = username(value);
  if (!config.bots.some((bot) => bot.botUsername === botUsername)) throw httpError(404, "Bot not configured");
  return botUsername;
}

function routeParts(pathname) {
  return pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

function requireAdmin(request) {
  if (!config.adminApiKey || !safeEqual(bearerToken(request), config.adminApiKey)) throw httpError(401, "Admin authorization required");
}

function requireOwner(request, user) {
  if (!safeEqual(hash(bearerToken(request)), user.ownerTokenHash)) throw httpError(401, "Owner authorization required");
}

function bearerToken(request) {
  return request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1] ?? "";
}

function safeEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw httpError(413, "Request body too large");
  }
  try { return JSON.parse(body); } catch { throw httpError(400, "Request body must be valid JSON"); }
}

function username(value) {
  const normalized = String(value ?? "").replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(normalized)) throw httpError(400, "xUsername must be a valid X username");
  return normalized;
}

function safeName(value) {
  if (value === undefined || value === null) return null;
  const name = String(value).trim();
  if (!name || name.length > 80) throw httpError(400, "displayName must be 1 to 80 characters");
  return name;
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function sendHtml(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" });
  response.end(body);
}

function portfolioPage(user) {
  const { portfolio } = user;
  const total = portfolio.hideValues ? "Hidden" : money(portfolio.totalValueUsd);
  const rows = portfolio.holdings.map((holding) => `<tr><td><strong>${escapeHtml(holding.symbol)}</strong>${holding.name ? `<small>${escapeHtml(holding.name)}</small>` : ""}</td><td>${formatNumber(holding.quantity)}</td><td>${portfolio.hideValues ? "—" : money(holding.valueUsd)}</td></tr>`).join("");
  return page(`${escapeHtml(user.displayName)}’s portfolio`, `<main><p class="eyebrow">PUBLIC PORTFOLIO</p><h1>${escapeHtml(user.displayName)}</h1><p class="muted">Shared voluntarily · Updated ${escapeHtml(new Date(portfolio.updatedAt).toLocaleString())}</p><section class="total"><span>Total value</span><strong>${total}</strong></section><table><thead><tr><th>Asset</th><th>Quantity</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table><p class="risk">Not investment advice. Holdings can change and may not represent every account or asset.</p></main>`);
}

function setupPage() {
  return page("Set up public portfolio", "<main><p class=\"eyebrow\">XBOT SETUP</p><h1>Share only what you choose.</h1><p>This starter service exposes owner-authorized API endpoints for a future authenticated dashboard. A public X mention never reveals a portfolio unless its owner has enabled sharing.</p><p>See the README for provisioning and portfolio update commands.</p></main>");
}

function notFoundPage() { return page("Portfolio unavailable", "<main><h1>Portfolio unavailable</h1><p>This portfolio is private, unpublished, or does not exist.</p></main>"); }
function page(title, content) { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#0b1020;color:#e8eaf0;font:16px system-ui,sans-serif}main{max-width:680px;margin:48px auto;padding:0 24px}.eyebrow{color:#7dd3fc;font-size:.75rem;font-weight:700;letter-spacing:.12em}.muted,small{color:#a4adc2}.total{display:flex;justify-content:space-between;align-items:center;padding:22px;margin:28px 0;background:#141b31;border-radius:14px}.total span{color:#a4adc2}.total strong{font-size:1.6rem}table{width:100%;border-collapse:collapse}th,td{padding:14px 0;border-bottom:1px solid #27324d;text-align:right}th:first-child,td:first-child{text-align:left}small{display:block;margin-top:3px}.risk{margin-top:28px;color:#a4adc2;font-size:.85rem;line-height:1.5}</style></head><body>${content}</body></html>`; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function money(value) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function formatNumber(value) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value); }
