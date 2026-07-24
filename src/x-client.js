const API_URL = "https://api.x.com/2";

export class XClient {
  constructor(config) {
    this.config = config;
  }

  configured() {
    return Boolean(this.config.botUserId && this.config.userAccessToken);
  }

  async getMentions(sinceId) {
    const url = new URL(`${API_URL}/users/${this.config.botUserId}/mentions`);
    url.searchParams.set("max_results", "20");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,name");
    if (sinceId) url.searchParams.set("since_id", sinceId);
    const response = await fetch(url, { headers: this.headers() });
    return this.read(response);
  }

  async reply(postId, text) {
    const response = await fetch(`${API_URL}/tweets`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: postId } })
    });
    return this.read(response);
  }

  headers() {
    return { authorization: `Bearer ${this.config.userAccessToken}` };
  }

  async read(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`X API ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }
}
