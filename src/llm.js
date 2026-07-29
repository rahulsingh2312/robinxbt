// DeepSeek speaks the OpenAI chat-completions dialect, so this is a thin
// client rather than an SDK dependency. It runs a tool-calling loop where the
// tools are backed by the Robinhood MCP connection.
const SYSTEM_PROMPT = `You are a stock-market bot replying on X (Twitter).

Rules:
- Reply in under 240 characters. One or two sentences. No hashtags, no emoji spam, no links.
- Dry, confident, a little witty. Never breathless. Never hype.
- ALWAYS ground claims in tool data. Call the tools to get real prices before quoting a number.
- X allows only ONE cashtag per post. Cash-tag at most your single top pick ($NVDA); write every other ticker as plain text (AMD, AVGO).
- If you genuinely cannot get data, say so plainly in one short sentence.
- You are not a financial adviser and you never claim certainty about the future.`;

// Without a Robinhood connection there are no tools, and the model's price
// knowledge is stale training data. Stating those as current is the worst
// failure mode available, so the no-data case gets its own instruction.
const NO_DATA_PROMPT = `
You currently have NO live market data connection.
- NEVER state a specific price, quote, percentage move, or market cap. You do not know them.
- Do not guess or recall numbers from memory. They are months out of date and would be wrong.
- Answer qualitatively: the business, the sector, the risk, the thesis.
- If asked point-blank for a price, say you can't pull live quotes right now, in one short clause.
- You may still name tickers you find interesting as cash-tags.`;

// The model gets every MCP tool EXCEPT mutations. A trade only ever happens
// through the explicit confirm flow, so no generated text can move money on
// its own — but everything readable (quotes, positions, balances, history,
// watchlists, search) is fair game for grounding a reply.
const WRITE_TOOL = /order|buy|sell|trade|transfer|deposit|withdraw|cancel|replace|modify|update|delete|remove|add|create|set_/i;

// CJK, Hangul, Cyrillic, Arabic, Hebrew, Devanagari, Thai. Latin accents and
// punctuation are fine — this is about a reply switching writing systems.
const NON_LATIN = /[Ѐ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿぀-ヿ㐀-䶿一-鿿가-힯]/;

export class LlmClient {
  constructor({ baseUrl, apiKey, model, reasoningEffort = "low", broker = null, chainTools = null, maxToolRounds = 4, timeoutMs = 60_000, logger = console, systemPrompt = SYSTEM_PROMPT, noDataPrompt = NO_DATA_PROMPT, styleProvider = null, retryNonEnglish = false }) {
    this.baseUrl = (baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model ?? "deepseek-v4-pro";
    // deepseek-v4-pro is a reasoning model: `low` keeps latency and token spend
    // down for what is only ever a one-tweet answer. Valid values are
    // low | medium | high | xhigh | max.
    this.reasoningEffort = reasoningEffort;
    this.broker = broker;
    // Answers "what trades on this chain", which the market-data tools cannot:
    // they price tickers globally, and a global price is not an asset anyone
    // here can buy.
    this.chainTools = chainTools;
    this.maxToolRounds = maxToolRounds;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.systemPrompt = systemPrompt;
    this.noDataPrompt = noDataPrompt;
    // A prompt rule alone did not hold: replies came back with Chinese
    // characters spliced mid-sentence. Detecting the script and asking again
    // is deterministic where an instruction was not.
    this.retryNonEnglish = retryNonEnglish;
    // Async () => string of extra system-prompt material (e.g. style examples
    // scraped from a real account). Fetched per turn so it can stay fresh.
    this.styleProvider = styleProvider;
  }

  configured() {
    return Boolean(this.apiKey);
  }

  // Exposes every read-only Robinhood MCP tool in OpenAI function-calling
  // shape, discovered live so a Robinhood rename does not need a code change.
  async tools() {
    if (this.toolCache) return this.toolCache;
    if (!this.broker) {
      this.toolCache = this.chainTools?.definitions() ?? [];
      this.readNames = new Set();
      return this.toolCache;
    }
    const available = await this.broker.listTools().catch(() => []);
    this.toolCache = available
      .filter((tool) => !WRITE_TOOL.test(tool.name))
      .map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description?.slice(0, 300) ?? `Robinhood ${tool.name}`,
          parameters: tool.inputSchema ?? { type: "object", properties: {} }
        }
      }));
    this.readNames = new Set(this.toolCache.map((tool) => tool.function.name));
    if (this.chainTools) this.toolCache = [...this.chainTools.definitions(), ...this.toolCache];
    return this.toolCache;
  }

  async ask(question) {
    const answer = await this.answer(question);
    if (!this.retryNonEnglish || !NON_LATIN.test(answer.text)) return answer;
    this.logger.warn("Reply contained non-Latin script; asking again in English");
    const retry = await this.answer(`${question}\n\nWrite the reply in English only. No other scripts or languages.`);
    // A second failure still beats posting half a sentence of another script.
    return NON_LATIN.test(retry.text) ? { ...retry, text: "" } : retry;
  }

  async answer(question) {
    const tools = await this.tools();
    // A style-corpus failure must never take the reply down with it: the
    // persona prompt alone is a complete instruction set.
    const style = this.styleProvider ? await this.styleProvider().catch(() => "") : "";
    const messages = [
      { role: "system", content: (tools.length > 0 ? this.systemPrompt : this.systemPrompt + this.noDataPrompt) + style },
      { role: "user", content: question }
    ];

    for (let round = 0; round <= this.maxToolRounds; round += 1) {
      const message = await this.complete(messages, round < this.maxToolRounds ? tools : []);
      messages.push(message);
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        const text = (message.content ?? "").trim();
        if (text) return { text, rounds: round };
        // Content can come back empty when reasoning ate the budget. Silence
        // posts a canned fallback, so ask once more with nothing to think
        // about but the sentence.
        return { text: await this.finalAnswer(messages), rounds: round };
      }

      for (const call of calls) {
        const result = await this.runTool(call);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    // Tool rounds exhausted: everything needed has been fetched, so demand the
    // reply itself rather than returning nothing.
    return { text: await this.finalAnswer(messages), rounds: this.maxToolRounds };
  }

  // One last completion with no tools available and an explicit instruction to
  // just answer. Returns "" only if even that fails.
  async finalAnswer(messages) {
    try {
      const message = await this.complete(
        [...messages, { role: "user", content: "Reply now, in your voice, using what you already have. Two sentences, plain text." }],
        []
      );
      return (message.content ?? "").trim();
    } catch (error) {
      this.logger.warn("Final answer attempt failed", error.message);
      return "";
    }
  }

  async runTool(call) {
    const name = call.function?.name;
    if (this.chainTools?.handles(name)) {
      let chainArgs = {};
      try { chainArgs = JSON.parse(call.function.arguments || "{}"); } catch { /* keep empty */ }
      return this.chainTools.run(name, chainArgs).catch((error) => `Error: ${String(error.message).slice(0, 200)}`);
    }
    // The denylist is enforced at execution too, not just at advertisement:
    // a model hallucinating a write tool name gets an error, not an order.
    if (!this.readNames?.has(name) || WRITE_TOOL.test(name)) return `Error: ${name} is not available.`;
    let args = {};
    try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* keep empty */ }
    try {
      const result = await this.broker.callByName(name, args);
      return (result.structured ? JSON.stringify(result.structured) : result.text || "").slice(0, 4000) || "No data.";
    } catch (error) {
      this.logger.warn(`Tool ${name} failed`, error.message);
      return `Error: ${String(error.message).slice(0, 200)}`;
    }
  }

  async complete(messages, tools) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
        // Reasoning tokens are drawn from this same budget. 400 was enough for
        // the model to think and then run out before writing anything, which
        // returns an empty string with finish_reason "length".
        max_tokens: 2000,
        reasoning_effort: this.reasoningEffort,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`LLM ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const body = await response.json();
    const choice = body.choices?.[0];
    if (!choice?.message) throw new Error("LLM returned no message");
    // Truncation mid-reasoning yields empty content and no tool calls, which
    // would otherwise surface as a silently blank reply.
    if (choice.finish_reason === "length" && !choice.message.content && !choice.message.tool_calls?.length) {
      throw new Error("LLM ran out of tokens before answering");
    }
    // reasoning_content must not be echoed back as an assistant message.
    const { reasoning_content: _reasoning, ...message } = choice.message;
    return message;
  }
}
