const botServer = process.env.BOT_SERVER_URL ?? "http://localhost:3000";

// The site is a pure front end. Wallet keys, sessions, and OAuth all live in
// the bot server; proxying keeps them same-origin so cookies just work and
// nothing sensitive is ever exposed to the browser as a separate host.
const nextConfig = {
  // The manage panel renders a withdraw form and a key-export button, so the
  // page must not be framable by anyone.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "x-frame-options", value: "DENY" },
        { key: "content-security-policy", value: "frame-ancestors 'none'" },
        { key: "x-content-type-options", value: "nosniff" },
        { key: "referrer-policy", value: "no-referrer" }
      ]
    }];
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${botServer}/api/:path*` },
      { source: "/auth/:path*", destination: `${botServer}/auth/:path*` }
    ];
  }
};

export default nextConfig;
