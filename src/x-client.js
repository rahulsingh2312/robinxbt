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
    // referenced_tweets.id pulls the parent post's full text into `includes`,
    // which is the only way to answer "@bot is this true" — the mention alone
    // carries no claim to judge.
    url.searchParams.set("expansions", "author_id,referenced_tweets.id");
    url.searchParams.set("user.fields", "username,name");
    url.searchParams.set("tweet.fields", "referenced_tweets,conversation_id,text,author_id");
    if (sinceId) url.searchParams.set("since_id", sinceId);
    const response = await fetch(url, { headers: this.headers("GET", url) });
    return this.read(response);
  }

  // Single post lookup, for when a mention arrives without its parent already
  // expanded — the stream and webhook paths do not always carry `includes`.
  async getPost(postId) {
    const url = new URL(`${API_URL}/tweets/${postId}`);
    // referenced_tweets comes back too, so the worker can walk further up a
    // thread for context without a second round trip per hop.
    url.searchParams.set("tweet.fields", "text,author_id,referenced_tweets,conversation_id");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username");
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
