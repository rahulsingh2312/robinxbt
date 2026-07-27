import { authorizationHeader } from "./oauth1.js";

const API_URL = "https://api.x.com/2";

export class XClient {
  constructor(config) {
    this.config = config;
  }

  configured() {
    return Boolean(this.config.botUserId && (this.config.userAccessToken || this.config.oauth1));
  }

  async getMentions(sinceId) {
    const url = new URL(`${API_URL}/users/${this.config.botUserId}/mentions`);
    url.searchParams.set("max_results", "20");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,name");
    // referenced_tweets is what links a "confirm" reply back to the basket the
    // bot proposed in the post being replied to.
    url.searchParams.set("tweet.fields", "referenced_tweets,conversation_id");
    if (sinceId) url.searchParams.set("since_id", sinceId);
    const response = await fetch(url, { headers: this.headers("GET", url) });
    return this.read(response);
  }

  // A standalone post on the bot's own timeline, not a reply.
  async post(text) {
    const url = `${API_URL}/tweets`;
    const response = await fetch(url, {
      method: "POST",
      headers: { ...this.headers("POST", url), "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
    return this.read(response);
  }

  async reply(postId, text) {
    const url = `${API_URL}/tweets`;
    const response = await fetch(url, {
      method: "POST",
      headers: { ...this.headers("POST", url), "content-type": "application/json" },
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: postId } })
    });
    return this.read(response);
  }

  headers(method, url) {
    if (this.config.oauth1) {
      return { authorization: authorizationHeader({ method, url, credentials: this.config.oauth1 }) };
    }
    return { authorization: `Bearer ${this.config.userAccessToken}` };
  }

  async read(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`X API ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }
}
