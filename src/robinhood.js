import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

export const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";

// Robinhood does not publish its tool names, and they will change as the beta
// moves on from equities-only. Tools are therefore resolved from the live
// tools/list response instead of hardcoded, with an env override as an escape
// hatch when a rename outpaces these patterns.
const TOOL_PATTERNS = {
  placeOrder: [/place.*order/i, /create.*order/i, /submit.*order/i, /^(buy|trade)/i],
  quote: [/quote/i, /price/i],
  positions: [/position/i, /holding/i],
  account: [/account/i, /balance/i, /portfolio/i]
};

export class RobinhoodClient {
  constructor({ authProvider, url = ROBINHOOD_MCP_URL, toolOverrides = {}, logger = console }) {
    this.authProvider = authProvider;
    this.url = url;
    this.toolOverrides = toolOverrides;
    this.logger = logger;
    this.tools = null;
  }

  async connect() {
    if (this.client) return this.client;
    const client = new Client({ name: "xbot", version: "0.1.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(this.url), { authProvider: this.authProvider });
    try {
      await client.connect(transport);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw new Error("Robinhood is not authorized. Run `npm run robinhood:login` on a desktop machine first.");
      }
      throw error;
    }
    this.client = client;
    this.transport = transport;
    return client;
  }

  async listTools() {
    const client = await this.connect();
    if (!this.tools) this.tools = (await client.listTools()).tools ?? [];
    return this.tools;
  }

  async resolveTool(kind) {
    if (this.toolOverrides[kind]) return this.toolOverrides[kind];
    const tools = await this.listTools();
    for (const pattern of TOOL_PATTERNS[kind] ?? []) {
      const match = tools.find((tool) => pattern.test(tool.name));
      if (match) return match.name;
    }
    throw new Error(
      `No Robinhood MCP tool matched "${kind}". Available: ${tools.map((tool) => tool.name).join(", ") || "none"}. ` +
      `Set ROBINHOOD_TOOL_${kind.toUpperCase()} to pin the correct name.`
    );
  }

  async call(kind, argumentsObject) {
    return this.callByName(await this.resolveTool(kind), argumentsObject);
  }

  // Direct invocation for callers (the LLM tool loop) that already hold the
  // exact MCP tool name from tools/list.
  async callByName(name, argumentsObject) {
    const client = await this.connect();
    const result = await client.callTool({ name, arguments: argumentsObject });
    if (result.isError) throw new Error(`Robinhood ${name} failed: ${textOf(result)}`);
    return { name, text: textOf(result), structured: result.structuredContent ?? null };
  }

  // Argument names vary between MCP servers, so the order payload is built from
  // the tool's own input schema rather than assumed.
  async placeOrder({ side, symbol, quantity, notionalUsd }) {
    const name = await this.resolveTool("placeOrder");
    const tool = (await this.listTools()).find((candidate) => candidate.name === name);
    const properties = tool?.inputSchema?.properties ?? {};
    const argumentsObject = {};
    const set = (candidates, value) => {
      if (value === undefined || value === null) return;
      const key = candidates.find((candidate) => candidate in properties);
      if (key) argumentsObject[key] = value;
    };
    set(["symbol", "ticker", "instrument"], symbol);
    set(["side", "action", "direction"], side);
    set(["quantity", "qty", "shares"], quantity);
    set(["amount", "notional", "notional_amount", "dollar_amount"], notionalUsd);
    set(["type", "order_type"], "market");
    set(["time_in_force", "timeInForce"], "gfd");

    const client = await this.connect();
    const result = await client.callTool({ name, arguments: argumentsObject });
    if (result.isError) throw new Error(`Order rejected: ${textOf(result)}`);
    return { name, arguments: argumentsObject, text: textOf(result), structured: result.structuredContent ?? null };
  }

  async close() {
    await this.transport?.close?.();
    this.client = undefined;
  }
}

function textOf(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}
