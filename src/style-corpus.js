// Pulls a public account's recent posts and formats them as style-reference
// material for the persona prompt. Reads are billed per post returned
// (~$0.005), and the same post re-read inside a UTC day is charged once, so a
// long cache TTL keeps this at pennies per day.
const API_URL = "https://api.x.com/2";

export class StyleCorpus {
  constructor({ bearerToken, userId, maxPosts = 15, refreshMs = 12 * 60 * 60 * 1000, logger = console, fetcher = fetch }) {
    this.bearerToken = bearerToken;
    this.userId = userId;
    // The timeline endpoint accepts 5–100; anything outside is a 400.
    this.maxPosts = Math.min(100, Math.max(5, maxPosts));
    this.refreshMs = refreshMs;
    this.logger = logger;
    this.fetcher = fetcher;
    this.cached = "";
    this.fetchedAt = 0;
  }

  // Returns a system-prompt block, or "" when the corpus is unavailable — the
  // persona works without it, so a fetch failure only costs freshness.
  async block() {
    if (this.cached && Date.now() - this.fetchedAt < this.refreshMs) return this.cached;
    try {
      const url = new URL(`${API_URL}/users/${this.userId}/tweets`);
      url.searchParams.set("max_results", String(this.maxPosts));
      // Retweets are someone else's voice and replies are mostly context-free
      // fragments; neither is style material.
      url.searchParams.set("exclude", "retweets,replies");
      const response = await this.fetcher(url, { headers: { authorization: `Bearer ${this.bearerToken}` } });
      if (!response.ok) throw new Error(`X API ${response.status}`);
      const body = await response.json();
      const posts = (body.data ?? []).map((post) => post.text?.replace(/\s+/g, " ").trim()).filter(Boolean);
      if (posts.length === 0) return this.cached;
      this.cached = [
        "\n\nRecent real posts by the public figure you parody. STYLE REFERENCE ONLY:",
        "- Absorb the cadence and vocabulary; never copy a post verbatim.",
        "- Never present any of these, altered or not, as a real quote.",
        ...posts.map((post) => `> ${post}`)
      ].join("\n");
      this.fetchedAt = Date.now();
    } catch (error) {
      this.logger.warn(`Style corpus fetch failed: ${error.message}`);
    }
    return this.cached;
  }
}
