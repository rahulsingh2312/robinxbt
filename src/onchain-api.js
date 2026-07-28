import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { formatEther, parseUnits } from "ethers";
import { NATIVE } from "./dex.js";
import { RateLimiter, clientIp, originAllowed } from "./http-guard.js";

// A stolen session cookie is the realistic threat here, so the endpoints that
// move money are each rate limited, and the one that hands over the private
// key additionally demands a login fresh enough that the attacker would have
// had to steal the X account itself.
const EXPORT_MAX_SESSION_AGE_MS = 30 * 60 * 1000;

// HTTP surface for the portfolio site. The site never holds keys or sessions
// itself — it proxies /api/onchain and /auth here, so the browser's cookies
// are scoped to the site origin while all signing stays in this process.
//
// Sessions are proven by X OAuth 2.0 (PKCE): the only person who can manage a
// wallet is whoever can log in to the X account that talked to the bot. That
// is the same identity anchor the wallet was created under (numeric user ID).
export class OnchainApi {
  constructor({ config, store, vault, chain, onchain, logger = console, fetchImpl = fetch }) {
    this.config = config;
    this.store = store;
    this.vault = vault;
    this.chain = chain;
    this.onchain = onchain;
    this.logger = logger;
    this.fetch = fetchImpl;
    const onchainConfig = config.onchain;
    // Session cookies need a signing secret even if the operator only set the
    // wallet key; deriving it keeps setup one-variable simple. Note this ties
    // session validity to the wallet key: rotating it logs everyone out.
    this.sessionSecret = onchainConfig.sessionSecret
      || (onchainConfig.walletEncKey ? createHash("sha256").update(`session:${onchainConfig.walletEncKey}`).digest("hex") : "");
    this.defaultBot = config.bots[0]?.botUsername;
    // Cookies ride through the Vercel proxy to the site's https origin, where
    // browsers require Secure. Derived from the site URL so local http dev
    // still works.
    this.secureCookies = config.onchain.siteBaseUrl.startsWith("https:");
    // Requests may legitimately arrive at the site origin or, in local
    // development, directly at this server.
    this.allowedOrigins = [config.onchain.siteBaseUrl, config.publicBaseUrl].filter(Boolean);
    this.limits = {
      login: new RateLimiter({ windowMs: 10 * 60_000, max: 20 }),
      portfolio: new RateLimiter({ windowMs: 60_000, max: 60 }),
      move: new RateLimiter({ windowMs: 10 * 60_000, max: 10 }),
      export: new RateLimiter({ windowMs: 60 * 60_000, max: 3 })
    };
  }

  // Every state-changing route runs through this: same-origin only, then a
  // per-session (or per-IP, pre-login) budget.
  guard(request, response, { limiter, key }) {
    if (!originAllowed(request, this.allowedOrigins)) {
      sendJson(response, 403, { error: "Cross-origin requests are not allowed" });
      return false;
    }
    const retryAfter = limiter.check(key);
    if (retryAfter !== null) {
      response.setHeader("retry-after", String(retryAfter));
      sendJson(response, 429, { error: `Too many attempts. Try again in ${retryAfter}s.` });
      return false;
    }
    return true;
  }

  oauthReady() {
    return Boolean(this.config.onchain.oauth.clientId && this.sessionSecret);
  }

  // Returns true when the request was handled here.
  async route(request, response, url) {
    const { pathname } = url;
    if (request.method === "GET" && pathname.startsWith("/api/onchain/portfolio/")) {
      if (this.limits.portfolio.check(clientIp(request)) !== null) {
        return sendJson(response, 429, { error: "Slow down." }), true;
      }
      await this.portfolio(response, decodeURIComponent(pathname.split("/").filter(Boolean)[3] ?? ""));
      return true;
    }
    if (request.method === "GET" && pathname === "/api/onchain/me") { await this.me(request, response); return true; }
    if (request.method === "GET" && pathname === "/auth/x/login") {
      if (this.limits.login.check(clientIp(request)) !== null) {
        return sendJson(response, 429, { error: "Too many sign-in attempts. Try again shortly." }), true;
      }
      await this.login(response, url);
      return true;
    }
    if (request.method === "GET" && pathname === "/auth/x/callback") { await this.callback(request, response, url); return true; }
    if (request.method === "POST" && pathname === "/auth/logout") {
      setCookie(response, "xbot_session", "", 0, this.secureCookies);
      sendJson(response, 200, { ok: true });
      return true;
    }
    if (request.method === "POST" && pathname === "/api/onchain/withdraw") { await this.withdraw(request, response); return true; }
    if (request.method === "POST" && pathname === "/api/onchain/sell") { await this.sell(request, response); return true; }
    if (request.method === "POST" && pathname === "/api/onchain/export-key") { await this.exportKey(request, response); return true; }
    return false;
  }

  async portfolio(response, rawUsername) {
    const username = String(rawUsername).replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(username)) return sendJson(response, 400, { error: "Invalid username" });
    const wallet = await this.store.getWalletByUsername(this.defaultBot, username);
    if (!wallet) return sendJson(response, 404, { error: "No wallet yet — talk to the bot on X first" });
    const [eth, holdings, ethUsd] = await Promise.all([
      this.chain.getEthBalance(wallet.address),
      this.onchain.fetchHoldings(wallet.address),
      this.onchain.dex.ethUsdPrice().catch(() => null)
    ]);
    const ethAmount = Number(formatEther(eth));
    sendJson(response, 200, {
      username,
      address: wallet.address,
      chainId: 4663,
      explorer: `${this.config.onchain.blockscoutBaseUrl}/address/${wallet.address}`,
      eth: { amount: ethAmount, valueUsd: ethUsd ? ethAmount * ethUsd : null },
      tokens: holdings,
      totalUsd: holdings.reduce((sum, holding) => sum + (holding.valueUsd ?? 0), ethUsd ? ethAmount * ethUsd : 0)
    });
  }

  async me(request, response) {
    const session = this.session(request);
    if (!session) return sendJson(response, 401, { error: "Not signed in" });
    const wallet = await this.store.getWalletByAuthor(this.defaultBot, session.authorId);
    sendJson(response, 200, { authorId: session.authorId, username: session.username, address: wallet?.address ?? null });
  }

  // --- X OAuth 2.0 with PKCE -------------------------------------------------

  async login(response, url) {
    if (!this.oauthReady()) return sendJson(response, 503, { error: "Sign-in needs X_CLIENT_ID and WALLET_ENC_KEY/SESSION_SECRET" });
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(16).toString("base64url");
    const returnTo = safeReturnPath(url.searchParams.get("return"));
    setCookie(response, "xbot_oauth", this.signValue(`${verifier}.${state}.${returnTo}`), 600, this.secureCookies);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL("https://x.com/i/oauth2/authorize");
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.onchain.oauth.clientId,
      redirect_uri: `${this.config.onchain.siteBaseUrl}/auth/x/callback`,
      scope: "users.read tweet.read",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    }).toString();
    response.writeHead(302, { location: authorize.toString() });
    response.end();
  }

  async callback(request, response, url) {
    const cookieValue = this.verifyValue(cookies(request).xbot_oauth ?? "");
    const code = url.searchParams.get("code");
    if (!cookieValue || !code) return sendJson(response, 400, { error: "Sign-in expired, start again" });
    const [verifier, state, returnTo] = cookieValue.split(".");
    if (url.searchParams.get("state") !== state) return sendJson(response, 400, { error: "State mismatch" });

    const { clientId, clientSecret } = this.config.onchain.oauth;
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    // A confidential client authenticates with Basic auth; a public client
    // sends only the PKCE verifier.
    if (clientSecret) headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    const tokenResponse = await this.fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: `${this.config.onchain.siteBaseUrl}/auth/x/callback`,
        code_verifier: verifier
      }).toString()
    });
    if (!tokenResponse.ok) {
      this.logger.warn("OAuth token exchange failed", await tokenResponse.text());
      return sendJson(response, 502, { error: "X sign-in failed" });
    }
    const { access_token } = await tokenResponse.json();
    const meResponse = await this.fetch("https://api.x.com/2/users/me", { headers: { authorization: `Bearer ${access_token}` } });
    if (!meResponse.ok) return sendJson(response, 502, { error: "Could not read X profile" });
    const me = (await meResponse.json()).data;

    const session = { authorId: String(me.id), username: me.username.toLowerCase(), iat: Date.now(), exp: Date.now() + 7 * 86_400_000 };
    setCookie(response, "xbot_oauth", "", 0, this.secureCookies);
    setCookie(response, "xbot_session", this.signValue(Buffer.from(JSON.stringify(session)).toString("base64url")), 7 * 86_400, this.secureCookies);
    response.writeHead(302, { location: `${this.config.onchain.siteBaseUrl}${returnTo || `/u/${session.username}`}` });
    response.end();
  }

  // --- Manage endpoints (session required) ----------------------------------

  async withdraw(request, response) {
    const session = this.session(request);
    if (!session) return sendJson(response, 401, { error: "Sign in with X first" });
    if (!this.guard(request, response, { limiter: this.limits.move, key: `w:${session.authorId}` })) return;
    const wallet = await this.store.getWalletByAuthor(this.defaultBot, session.authorId);
    if (!wallet) return sendJson(response, 404, { error: "No wallet for this account" });
    const body = await readJson(request);
    const to = String(body.to ?? "");
    const amount = Number(body.amount);
    const asset = String(body.asset ?? "eth").toLowerCase();
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return sendJson(response, 400, { error: "`to` must be a 0x address" });
    if (!Number.isFinite(amount) || amount <= 0) return sendJson(response, 400, { error: "`amount` must be positive" });
    const signer = this.vault.signerFor(wallet, this.chain.provider);
    try {
      const receipt = asset === "eth"
        ? await this.chain.sendEth(signer, to, amount)
        : await this.chain.sendToken(signer, asset, to, amount);
      this.logger.info(`Withdraw by @${session.username}: ${amount} ${asset} -> ${to}, tx ${receipt.hash}`);
      sendJson(response, 200, { hash: receipt.hash });
    } catch (error) {
      sendJson(response, 502, { error: String(error.shortMessage ?? error.message).slice(0, 200) });
    }
  }

  // Sells swap a token back to ETH through the same Uniswap v4 route
  // discovery the buys use, from the signed-in owner's wallet only.
  async sell(request, response) {
    const session = this.session(request);
    if (!session) return sendJson(response, 401, { error: "Sign in with X first" });
    if (!this.guard(request, response, { limiter: this.limits.move, key: `s:${session.authorId}` })) return;
    const wallet = await this.store.getWalletByAuthor(this.defaultBot, session.authorId);
    if (!wallet) return sendJson(response, 404, { error: "No wallet for this account" });
    const body = await readJson(request);
    const token = String(body.token ?? "");
    const amount = Number(body.amount);
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return sendJson(response, 400, { error: "`token` must be a 0x address" });
    if (!Number.isFinite(amount) || amount <= 0) return sendJson(response, 400, { error: "`amount` must be positive" });
    try {
      const meta = await this.chain.getTokenMeta(token);
      const amountIn = parseUnits(String(body.amount), meta.decimals);
      const signer = this.vault.signerFor(wallet, this.chain.provider);
      const result = await this.onchain.dex.swap(signer, token, NATIVE, amountIn);
      this.logger.info(`Sell by @${session.username}: ${amount} ${meta.symbol} -> ETH, tx ${result.hash}`);
      sendJson(response, 200, { hash: result.hash, receivedEthAtLeast: formatEther(result.minAmountOut) });
    } catch (error) {
      sendJson(response, 502, { error: String(error.shortMessage ?? error.message).slice(0, 200) });
    }
  }

  // Hands the raw private key to its owner. This is deliberate: custody they
  // can exit at any time is the difference between a wallet service and a
  // trap. The site shows the appropriate warnings before calling this.
  async exportKey(request, response) {
    const session = this.session(request);
    if (!session) return sendJson(response, 401, { error: "Sign in with X first" });
    if (!this.guard(request, response, { limiter: this.limits.export, key: `k:${session.authorId}` })) return;
    // Handing over the key is irreversible, so a merely-valid session is not
    // enough: it has to be a session that was created minutes ago, which a
    // cookie thief cannot produce without the X account itself.
    if (!session.iat || Date.now() - session.iat > EXPORT_MAX_SESSION_AGE_MS) {
      return sendJson(response, 401, { error: "For key export, sign in with X again first.", reauth: true });
    }
    const wallet = await this.store.getWalletByAuthor(this.defaultBot, session.authorId);
    if (!wallet) return sendJson(response, 404, { error: "No wallet for this account" });
    this.logger.info(`Private key exported by @${session.username} (${session.authorId})`);
    sendJson(response, 200, { address: wallet.address, privateKey: this.vault.privateKeyOf(wallet) });
  }

  // --- Session plumbing ------------------------------------------------------

  session(request) {
    const raw = this.verifyValue(cookies(request).xbot_session ?? "");
    if (!raw) return null;
    try {
      const session = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
      return session.exp > Date.now() ? session : null;
    } catch {
      return null;
    }
  }

  signValue(value) {
    return `${value}.${createHmac("sha256", this.sessionSecret).update(value).digest("base64url")}`;
  }

  verifyValue(signed) {
    if (!this.sessionSecret) return null;
    const at = signed.lastIndexOf(".");
    if (at < 1) return null;
    const value = signed.slice(0, at);
    const expected = createHmac("sha256", this.sessionSecret).update(value).digest("base64url");
    const actual = signed.slice(at + 1);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) return null;
    return value;
  }
}

// Return paths come from the query string; anything but a local path would
// turn the login redirect into an open redirect.
function safeReturnPath(value) {
  const path = String(value ?? "");
  return /^\/[a-zA-Z0-9_\-/]*$/.test(path) ? path : "";
}

function cookies(request) {
  const header = request.headers.cookie ?? "";
  const result = {};
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) result[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return result;
}

function setCookie(response, name, value, maxAgeSeconds, secure = false) {
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
  const existing = response.getHeader("set-cookie");
  response.setHeader("set-cookie", existing ? [].concat(existing, cookie) : cookie);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw Object.assign(new Error("Body too large"), { statusCode: 413 });
  }
  try { return JSON.parse(body); } catch { return {}; }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
