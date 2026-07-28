// Defensive layer in front of the money-moving endpoints. Everything here
// assumes the session cookie will eventually leak (device theft, an on-path
// proxy, a borrowed laptop) and tries to make that leak survivable.

// Browsers never send a cross-site POST with SameSite=Lax cookies, so CSRF is
// already blocked at the cookie layer. This is the belt to that suspenders:
// a state-changing request must come from our own origin, or from no origin
// at all (curl with an explicit session, which needs the cookie anyway).
export function originAllowed(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin) return true;
  return allowedOrigins.some((allowed) => origin.toLowerCase() === allowed.toLowerCase());
}

// Fixed-window counter, keyed however the caller wants (session, IP, handle).
// In memory on purpose: a restart only ever loosens limits, and the numbers
// are small enough that a Redis dependency would cost more than it buys.
export class RateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
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

  sweep(now) {
    if (this.hits.size < 5000) return;
    for (const [key, entry] of this.hits) {
      if (now - entry.start >= this.windowMs) this.hits.delete(key);
    }
  }
}

// The client IP as seen through the Vercel proxy. Only the LAST hop of
// x-forwarded-for is trustworthy in general, but since the only path to this
// server is our own proxy, the first entry is the real client. Falls back to
// the socket address when the header is absent (direct hit).
export function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket?.remoteAddress ?? "unknown";
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
  const wrap = (level) => (...args) => base[level](...args.map((arg) => (typeof arg === "string" ? redact(arg) : arg)));
  return { info: wrap("info"), warn: wrap("warn"), error: wrap("error"), debug: wrap("debug") };
}
