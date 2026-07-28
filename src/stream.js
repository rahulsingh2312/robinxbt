// Filtered-stream consumer. X pushes matching posts over a long-lived HTTP
// connection, which works from behind NAT — no public URL required. Polling
// stays on as a backstop; claimMention in the worker dedupes double delivery.
const STREAM_URL = "https://api.x.com/2/tweets/search/stream"
  + "?tweet.fields=author_id,referenced_tweets,conversation_id,text"
  + "&expansions=author_id,referenced_tweets.id&user.fields=username";

export class MentionStream {
  constructor({ bearerToken, worker, logger = console }) {
    this.bearerToken = bearerToken;
    this.worker = worker;
    this.logger = logger;
    this.stopped = false;
    this.backoffMs = 1_000;
  }

  start() {
    this.run().catch((error) => this.logger.error("Stream loop exited", error));
  }

  stop() {
    this.stopped = true;
    this.abort?.abort();
  }

  async run() {
    while (!this.stopped) {
      try {
        await this.consume();
        this.backoffMs = 1_000;
      } catch (error) {
        if (this.stopped) return;
        this.logger.warn(`Stream disconnected (${String(error.message).slice(0, 120)}); retrying in ${this.backoffMs / 1000}s`);
      }
      if (this.stopped) return;
      await new Promise((resolve) => setTimeout(resolve, this.backoffMs));
      // X asks for exponential backoff on reconnect; 503 "provisioning" and
      // 429s both land here. Cap at 60s so recovery is never slower than that.
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    }
  }

  async consume() {
    this.abort = new AbortController();
    const response = await fetch(STREAM_URL, {
      headers: { authorization: `Bearer ${this.bearerToken}` },
      signal: this.abort.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`stream ${response.status}: ${body.slice(0, 140)}`);
    }
    this.logger.info("Filtered stream connected");
    this.backoffMs = 1_000;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stream closed by server");
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 2);
        if (!line) continue; // keep-alive heartbeat
        // Deliberately not awaited: a reply takes seconds (LLM turn + POST),
        // and blocking the read loop would make a second mention wait behind
        // the first. Errors are handled inside handleLine.
        this.handleLine(line);
      }
    }
  }

  async handleLine(line) {
    let payload;
    try { payload = JSON.parse(line); } catch { return; }
    const post = payload.data;
    if (!post?.id || !post.text) return;
    const username = (payload.includes?.users ?? []).find((user) => user.id === post.author_id)?.username;
    const parent = (post.referenced_tweets ?? []).find((reference) => reference.type !== "retweeted");
    const parentText = (payload.includes?.tweets ?? []).find((tweet) => tweet.id === parent?.id)?.text;
    // The bot's own replies match the @mention rule too — never answer them,
    // or every reply would spawn another reply forever.
    if (String(post.author_id) === String(this.worker.bot.botUserId ?? "")) return;
    await this.worker
      .handleMention({ ...post, username, parentText })
      .catch((error) => this.logger.error(`Stream mention ${post.id} failed: ${error.message}`));
  }
}
