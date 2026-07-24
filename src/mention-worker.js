import { publicSummary } from "./portfolio.js";

export class MentionWorker {
  constructor({ store, client, bot, publicBaseUrl, logger = console }) {
    this.store = store;
    this.client = client;
    this.bot = bot;
    this.publicBaseUrl = publicBaseUrl;
    this.logger = logger;
    this.running = false;
  }

  start() {
    if (!this.client.configured()) {
      this.logger.warn("X polling is disabled: set X_BOT_USER_ID and X_BOT_USER_ACCESS_TOKEN to enable it.");
      return;
    }
    this.tick().catch((error) => this.logger.error("Initial X poll failed", error));
    this.timer = setInterval(() => this.tick().catch((error) => this.logger.error(`X poll failed for @${this.bot.botUsername}`, error)), this.bot.pollIntervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const response = await this.client.getMentions(await this.store.getLastMentionId(this.bot.botUsername));
      const usernames = new Map((response.includes?.users ?? []).map((user) => [user.id, user.username]));
      const posts = [...(response.data ?? [])].sort((first, second) => BigInt(first.id) < BigInt(second.id) ? -1 : 1);
      for (const post of posts) {
        const username = usernames.get(post.author_id) ?? "there";
        const reply = await this.commandReply(post.text, username);
        if (this.bot.dryRun) {
          this.logger.info(`[dry run] reply to ${post.id}: ${reply}`);
        } else {
          await this.client.reply(post.id, reply);
        }
        await this.store.setLastMentionId(this.bot.botUsername, post.id);
      }
    } finally {
      this.running = false;
    }
  }

  async commandReply(text, username) {
    const command = text.replace(new RegExp(`@${this.bot.botUsername}\\b`, "ig"), "").trim().toLowerCase();
    if (/^portfolio\b/.test(command)) {
      const user = await this.store.getUser(this.bot.botUsername, username);
      if (user?.publicSharing && user.portfolio) {
        const summary = publicSummary(user);
        return `@${username} ${summary}${user.portfolio.hideValues ? "" : ` · $${formatMoney(user.portfolio.totalValueUsd)}`}\n${this.publicBaseUrl}/p/${encodeURIComponent(this.bot.botUsername)}/${encodeURIComponent(username)}`;
      }
      return `@${username} Set up your opt-in public portfolio: ${this.publicBaseUrl}/setup`;
    }
    if (/^(buy|sell|swap|trade)\b/.test(command)) {
      return `@${username} I never execute trades from public posts. Create and review a private order confirmation instead.`;
    }
    return `@${username} Try “portfolio” to share an opt-in public portfolio. Trading requests always require private confirmation.`;
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
