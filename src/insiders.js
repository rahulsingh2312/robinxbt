import { createHmac } from "node:crypto";

// The insiders agent verifies an HS256 JWT with a {userId} payload, minted with
// the same JWT_SECRET the Telegram bot uses. Signing it here by hand keeps xbot
// dependency-free rather than pulling in jsonwebtoken for nine lines of work.
export function mintAgentJwt(userId, secret, { ttlSeconds = 2_592_000 } = {}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ userId, iat: issuedAt, exp: issuedAt + ttlSeconds }));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export class InsidersClient {
  constructor({ baseUrl = "https://agent.insiders.bot", jwtSecret, userId, timeoutMs = 60_000, logger = console }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.jwtSecret = jwtSecret;
    this.userId = userId;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  configured() {
    return Boolean(this.jwtSecret && this.userId);
  }

  // One agent turn, SSE consumed server-side. Each X mention is its own
  // conversation: threads on X are public and short, and reusing a
  // conversation would leak one asker's context into another's reply.
  async ask(userMessage, { conversationId } = {}) {
    const token = mintAgentJwt(this.userId, this.jwtSecret);
    const response = await fetch(`${this.baseUrl}/api/agent/chat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify({
        conversation_id: conversationId ?? crypto.randomUUID(),
        user_message: userMessage,
        proposed_action: null
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (response.status === 429) throw new Error("Agent rate limited");
    if (!response.ok) throw new Error(`Agent ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return this.consume(response);
  }

  async consume(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let recommendation = null;
    let inspector = null;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        // Uvicorn terminates SSE blocks with CRLF, so both forms appear.
        const lf = buffer.indexOf("\n\n");
        const crlf = buffer.indexOf("\r\n\r\n");
        const index = lf === -1 ? crlf : crlf === -1 ? lf : Math.min(lf, crlf);
        if (index === -1) break;
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + (block.includes("\r") ? 4 : 2));
        const event = parseBlock(block);
        if (!event || event.event === "heartbeat") continue;
        if (event.event === "token") chunks.push(event.data.text ?? "");
        else if (event.event === "done") {
          recommendation = event.data.recommendation ?? null;
          inspector = event.data.inspector ?? null;
        }
      }
    }
    return { text: chunks.join("").trim(), recommendation, inspector };
  }
}

function parseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n").map((entry) => entry.replace(/\r$/, ""))) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) };
  } catch {
    return null;
  }
}

// X rejects any post carrying more than one cashtag with a 403. Models writing
// about markets cash-tag every ticker they mention, so all but the first are
// downgraded to plain text. $12.34 is not a cashtag — only $ followed by
// letters counts.
// Injected instructions in a tweet can steer the model's wording, so no
// outbound reply may carry a link: it would be phishing published from the
// bot's own account, at 13x the per-post price.
export function stripUrls(text) {
  return String(text)
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\b(?:www\.)[^\s]+/gi, "")
    .replace(/\b[a-z0-9-]+\.(?:com|net|org|io|xyz|co|app|link|gg|me|fi|finance)(?:\/\S*)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function limitCashtags(text, max = 1) {
  let seen = 0;
  return text.replace(/\$([A-Za-z]{1,6})\b/g, (match, symbol) => {
    seen += 1;
    return seen <= max ? match : symbol;
  });
}

// X rejects posts over 280 characters. Trimming at a sentence boundary reads as
// a finished thought rather than a truncation.
export function fitForPost(text, limit = 275) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  const cut = collapsed.slice(0, limit);
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentenceEnd > limit * 0.5) return cut.slice(0, sentenceEnd + 1);
  const wordEnd = cut.lastIndexOf(" ");
  return `${cut.slice(0, wordEnd > 0 ? wordEnd : limit - 1)}…`;
}
