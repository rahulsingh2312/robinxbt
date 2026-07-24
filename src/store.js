import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EMPTY_STORE = { users: {}, state: {} };

export class Store {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(EMPTY_STORE);
    this.pendingWrite = Promise.resolve();
  }

  async load() {
    await mkdir(dirname(this.file), { recursive: true });
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8"));
      this.data.users ??= {};
      this.data.state ??= {};
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.save();
    }
  }

  async save() {
    const content = JSON.stringify(this.data, null, 2);
    this.pendingWrite = this.pendingWrite.then(async () => {
      const temporaryFile = `${this.file}.tmp`;
      await writeFile(temporaryFile, content, { mode: 0o600 });
      await rename(temporaryFile, this.file);
    });
    return this.pendingWrite;
  }

  userKey(botUsername, username) {
    return `${botUsername.toLowerCase()}:${username.toLowerCase()}`;
  }

  async getUser(botUsername, username) {
    return this.data.users[this.userKey(botUsername, username)] ?? null;
  }

  async setUser(botUsername, username, user) {
    this.data.users[this.userKey(botUsername, username)] = user;
    await this.save();
  }

  // Claims a mention for trading exactly once. Returns false if it was already
  // claimed, so a crash between the fill and the reply cannot re-place an order.
  async claimOrder(botUsername, postId) {
    const key = this.userKey(botUsername, postId);
    this.data.orders ??= {};
    if (this.data.orders[key]) return false;
    this.data.orders[key] = { claimedAt: new Date().toISOString() };
    await this.save();
    return true;
  }

  // A basket proposed in a reply, keyed by the ID of the bot's own reply post.
  // A later "confirm" that references that post is what authorizes the buys.
  async savePendingBasket(botUsername, postId, basket) {
    this.data.baskets ??= {};
    this.data.baskets[this.userKey(botUsername, postId)] = { ...basket, createdAt: new Date().toISOString() };
    await this.save();
  }

  async getPendingBasket(botUsername, postId) {
    return this.data.baskets?.[this.userKey(botUsername, postId)] ?? null;
  }

  async clearPendingBasket(botUsername, postId) {
    if (!this.data.baskets) return;
    delete this.data.baskets[this.userKey(botUsername, postId)];
    await this.save();
  }

  // Claims a mention for handling exactly once across delivery paths — the
  // filtered stream, polling, and webhooks can all deliver the same post.
  async claimMention(botUsername, postId) {
    this.data.handled ??= {};
    const key = this.userKey(botUsername, postId);
    if (this.data.handled[key]) return false;
    this.data.handled[key] = Date.now();
    const keys = Object.keys(this.data.handled);
    if (keys.length > 2000) {
      for (const stale of keys.sort((a, b) => this.data.handled[a] - this.data.handled[b]).slice(0, 500)) {
        delete this.data.handled[stale];
      }
    }
    await this.save();
    return true;
  }

  async releaseMention(botUsername, postId) {
    delete this.data.handled?.[this.userKey(botUsername, postId)];
    await this.save();
  }

  async getPaperBook(botUsername, userId) {
    return this.data.paper?.[this.userKey(botUsername, userId)] ?? null;
  }

  async setPaperBook(botUsername, userId, book) {
    this.data.paper ??= {};
    this.data.paper[this.userKey(botUsername, userId)] = book;
    await this.save();
  }

  async recordSpend(botUsername, day, amountUsd) {
    this.data.spend ??= {};
    const key = `${botUsername.toLowerCase()}:${day}`;
    this.data.spend[key] = (this.data.spend[key] ?? 0) + amountUsd;
    await this.save();
  }

  async getSpend(botUsername, day) {
    return this.data.spend?.[`${botUsername.toLowerCase()}:${day}`] ?? 0;
  }

  async getLastMentionId(botUsername) {
    return this.data.state[botUsername.toLowerCase()]?.lastMentionId ?? null;
  }

  async setLastMentionId(botUsername, id) {
    this.data.state[botUsername.toLowerCase()] = { lastMentionId: id };
    await this.save();
  }
}
