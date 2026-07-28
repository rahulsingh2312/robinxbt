// Defensive layer in front of the money-moving endpoints. Everything here
// assumes the session cookie will eventually leak (device theft, an on-path
// proxy, a borrowed laptop) and tries to make that leak survivable.

import { timingSafeEqual } from "node:crypto";

// Browsers never send a cross-site POST with SameSite=Lax cookies, so CSRF is
// already blocked at the cookie layer. This is the belt to that suspenders:
// a state-changing request must come from our own origin, or from no origin
// at all (curl with an explicit session, which needs the cookie anyway).
export function originAllowed(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (origin) return allowedOrigins.some((allowed) => origin.toLowerCase() === allowed.toLowerCase());
  // No Origin at all: accept only when the browser states the request is
  // same-origin, or when it is a non-browser client that authenticated as our
  // proxy. Anything else fails closed.
  const site = request.headers["sec-fetch-site"];
  if (site) return site === "same-origin";
  return request.proxyAuthenticated === true;
}

// Fixed-window counter, keyed however the caller wants (session, IP, handle).
// In memory on purpose: a restart only ever loosens limits, and the numbers
// are small enough that a Redis dependency would cost more than it buys.
export class RateLimiter {
  constructor({ windowMs, max, maxKeys = 20_000 }) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxKeys = maxKeys;
    this.hits = new Map();
    this.lastSweep = 0;
  }

  // Returns null when allowed, or seconds to wait when limited.
  check(key) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      this.sweep(now);
      return null;
    }
    entry.count += 1;
    if (entry.count > this.max) return Math.ceil((entry.start + this.windowMs - now) / 1000);
    return null;
  }

  // Sweeping on every insert made each request O(n): a flood of distinct keys
  // drove per-request cost quadratic and blocked the event loop that signs
  // withdrawals. Sweep at most once per window, and cap the map outright.
  sweep(now) {
    if (now - this.lastSweep < this.windowMs && this.hits.size < this.maxKeys) return;
    this.lastSweep = now;
    for (const [key, entry] of this.hits) {
      if (now - entry.start >= this.windowMs) this.hits.delete(key);
    }
    // Still oversized after expiry means an active flood: drop the oldest
    // half rather than let memory grow without bound.
    if (this.hits.size >= this.maxKeys) {
      const drop = Math.ceil(this.hits.size / 2);
      let dropped = 0;
      for (const key of this.hits.keys()) {
        this.hits.delete(key);
        if (++dropped >= drop) break;
      }
    }
  }
}

// X-Forwarded-For is caller-controlled unless the caller is our own proxy, and
// this server answers on a public port. Trusting it blindly let anyone rotate
// a fake IP per request and bypass every rate limit, so the header counts only
// on requests the proxy authenticated; everyone else is keyed by socket.
export function clientIp(request, { trustForwarded = false } = {}) {
  if (trustForwarded) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0].trim();
  }
  return request.socket?.remoteAddress ?? "unknown";
}

// Requests that reach this server directly (not through the site) are refused
// when a proxy secret is configured, which is what makes the forwarded-for
// header trustworthy above.
export function proxyAuthenticated(request, secret) {
  if (!secret) return false;
  const provided = request.headers["x-proxy-secret"];
  if (typeof provided !== "string" || provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

// Applied to every response: no sniffing, no framing, no referrer leakage,
// and HSTS once we are actually behind TLS.
export function securityHeaders({ https }) {
  const headers = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin"
  };
  if (https) headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

// Anything that looks like key material must never reach a log line, an error
// body, or a reply. Applied at the logging boundary rather than trusting every
// call site to remember.
export function redact(value) {
  return String(value)
    .replace(/0x[0-9a-fA-F]{64}\b/g, "0x<redacted-key>")
    .replace(/\b[0-9a-fA-F]{64}\b/g, "<redacted-hex>")
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 <redacted>");
}

export function redactingLogger(base = console) {
  // Bound up front, because callers install the result back onto `console`.
  // Reading base[level] at call time would then resolve to the wrapper itself
  // and recurse until the stack blew — which crash-looped the service.
  const original = Object.fromEntries(
    ["info", "warn", "error", "debug"].map((level) => [level, (base[level] ?? base.log).bind(base)])
  );
  // Every risky call site logs an Error, not a string, so redaction has to
  // reach inside Errors and objects too.
  const clean = (arg) => {
    if (typeof arg === "string") return redact(arg);
    if (arg instanceof Error) {
      const copy = new Error(redact(arg.message));
      copy.stack = redact(arg.stack ?? "");
      return copy;
    }
    if (arg && typeof arg === "object") {
      try { return JSON.parse(redact(JSON.stringify(arg))); } catch { return "[unserializable]"; }
    }
    return arg;
  };
  const wrap = (level) => (...args) => original[level](...args.map(clean));
  return { info: wrap("info"), warn: wrap("warn"), error: wrap("error"), debug: wrap("debug") };
}
