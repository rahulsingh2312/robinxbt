import { NextResponse } from "next/server";

// Every proxied call carries a shared secret, so the wallet API can refuse
// anything that did not come through this site. Without it the API answers on
// a public port, where anyone could enumerate wallets or forge the client IP
// that rate limiting depends on.
export function middleware(request) {
  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set("x-proxy-secret", secret);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/api/:path*", "/auth/:path*"] };
