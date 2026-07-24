// One-time interactive setup. Robinhood's agentic OAuth requires a desktop
// browser and a loopback redirect, so this must run on a machine with a
// browser; the resulting refresh token is what the server reuses afterwards.
import { loadConfig } from "./config.js";
import { RobinhoodAuthProvider } from "./robinhood-auth.js";
import { RobinhoodClient } from "./robinhood.js";

const config = loadConfig();
const authProvider = new RobinhoodAuthProvider(config.trading);
authProvider.interactive = true;

const broker = new RobinhoodClient({ authProvider, toolOverrides: config.trading.toolOverrides });
const controller = new AbortController();
// Robinhood login can involve app-based 2FA; give it a generous window.
const timeout = setTimeout(() => controller.abort(), 15 * 60_000);

try {
  await broker.connect();
  console.info("Robinhood is already authorized.");
} catch (error) {
  if (!authProvider.pendingAuthorizationUrl) throw error;
  console.info(`\nOpen this URL in a desktop browser if it did not open automatically:\n\n${authProvider.pendingAuthorizationUrl}\n`);
  const code = await authProvider.waitForAuthorizationCode({ signal: controller.signal });
  await broker.transport?.finishAuth(code);
  // The transport that performed the exchange is spent; reconnect cleanly.
  await broker.close();
  broker.client = undefined;
  await broker.connect();
  console.info("Robinhood authorized.");
}

clearTimeout(timeout);

const tools = await broker.listTools();
console.info(`\nDiscovered ${tools.length} tool(s):\n`);
for (const tool of tools) {
  console.info(`  ${tool.name}${tool.description ? ` — ${tool.description.split("\n")[0].slice(0, 100)}` : ""}`);
}

console.info("\nResolved mappings:");
for (const kind of ["placeOrder", "quote", "positions", "account"]) {
  try {
    console.info(`  ${kind} → ${await broker.resolveTool(kind)}`);
  } catch (error) {
    console.info(`  ${kind} → unresolved (${error.message.split(".")[0]})`);
  }
}
console.info(`\nTokens stored at ${config.trading.tokenFile}. Keep this file secret.`);

await broker.close();
process.exit(0);
