import { mkdir, open as openFile, readFile, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

const EMPTY_STORE = { users: {}, state: {} };

export class Store {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(EMPTY_STORE);
    this.pendingWrite = Promise.resolve();
  }

  async load() {
    // 0700: the directory holds encrypted wallet keys, so no other local
    // account has any business listing or writing in it.
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
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
      // "wx" fails if the path exists and never follows a symlink, so another
      // local process cannot pre-create the temp file to capture wallet
      // ciphertext at a mode or location of its choosing. The random suffix
      // keeps the path unpredictable.
      const temporaryFile = `${this.file}.${randomBytes(6).toString("hex")}.tmp`;
      const handle = await openFile(temporaryFile, "wx", 0o600);
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporaryFile, this.file);
      } catch (error) {
        await unlink(temporaryFile).catch(() => {});
        throw error;
      }
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

  // Wallets are keyed by numeric author ID (stable), with a username index
  // maintained on write so the portfolio site can look up by handle.
  async getWalletByAuthor(botUsername, authorId) {
    return this.data.wallets?.[this.userKey(botUsername, authorId)] ?? null;
  }

  async setWallet(botUsername, authorId, record) {
    this.data.wallets ??= {};
    this.data.walletIndex ??= {};
    this.data.wallets[this.userKey(botUsername, authorId)] = record;
    if (record.xUsername) this.data.walletIndex[this.userKey(botUsername, record.xUsername)] = String(authorId);
    await this.save();
  }

  async listWallets(botUsername) {
    const prefix = `${botUsername.toLowerCase()}:`;
    return Object.entries(this.data.wallets ?? {})
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, record]) => ({ authorId: key.slice(prefix.length), record }));
  }

  async getWalletByUsername(botUsername, xUsername) {
    const authorId = this.data.walletIndex?.[this.userKey(botUsername, xUsername)];
    if (!authorId) return null;
    const record = await this.getWalletByAuthor(botUsername, authorId);
    return record ? { ...record, authorId } : null;
  }

  // A buy the bot proposed but that still needs an amount, keyed by the ID of
  // the bot's own reply — mirrors the pending-basket pattern.
  async savePendingBuy(botUsername, postId, buy) {
    this.data.pendingBuys ??= {};
    this.data.pendingBuys[this.userKey(botUsername, postId)] = { ...buy, createdAt: new Date().toISOString() };
    await this.save();
  }

  async getPendingBuy(botUsername, postId) {
    return this.data.pendingBuys?.[this.userKey(botUsername, postId)] ?? null;
  }

  async clearPendingBuy(botUsername, postId) {
    if (!this.data.pendingBuys) return;
    delete this.data.pendingBuys[this.userKey(botUsername, postId)];
    await this.save();
  }

  async getLastMentionId(botUsername) {
    return this.data.state[botUsername.toLowerCase()]?.lastMentionId ?? null;
  }

  async setLastMentionId(botUsername, id) {
    this.data.state[botUsername.toLowerCase()] = { lastMentionId: id };
    await this.save();
  }
}
