const botServer = process.env.BOT_SERVER_URL ?? "http://localhost:3000";

// The site is a pure front end. Wallet keys, sessions, and OAuth all live in
// the bot server; proxying keeps them same-origin so cookies just work and
// nothing sensitive is ever exposed to the browser as a separate host.
const nextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${botServer}/api/:path*` },
      { source: "/auth/:path*", destination: `${botServer}/auth/:path*` }
    ];
  }
};

export default nextConfig;
