import { fitForPost, limitCashtags } from "./insiders.js";

// Unprompted posting on a randomized cadence, so the timeline reads like a
// person with opinions rather than a cron job. Restart cost is at most one
// rescheduled delay — deliberately not persisted, since posting a few hours
// early after a deploy is harmless and worth the simpler store.
export class Shitposter {
  constructor({ client, llm, bot, seeds, minIntervalMs, maxIntervalMs, memory = 5, logger = console }) {
    this.client = client;
    this.llm = llm;
    this.bot = bot;
    this.seeds = seeds;
    this.minIntervalMs = minIntervalMs;
    this.maxIntervalMs = maxIntervalMs;
    this.logger = logger;
    // Independent generations against the same market data converge on the
    // same lede — two posts in a row opened "nvda down 5%". The model is shown
    // its recent posts and told to move on. Held in memory only: losing it on
    // restart costs one possibly-repetitive post, which is not worth a schema.
    this.memory = memory;
    this.recent = [];
    this.recentSeeds = [];
  }

  start() {
    this.schedule();
    this.logger.info(`Shitposter armed for @${this.bot.botUsername}: every ${Math.round(this.minIntervalMs / 60_000)}–${Math.round(this.maxIntervalMs / 60_000)} minutes${this.bot.dryRun ? " (dry run)" : ""}`);
  }

  stop() {
    clearTimeout(this.timer);
  }

  schedule() {
    this.timer = setTimeout(() => this.fire(), randomDelay(this.minIntervalMs, this.maxIntervalMs));
  }

  // Avoids seeds used recently, so the rotation cannot draw the same angle
  // twice running. Falls back to the full list once every seed is recent.
  pickSeed() {
    const fresh = this.seeds.filter((seed) => !this.recentSeeds.includes(seed));
    const pool = fresh.length > 0 ? fresh : this.seeds;
    const seed = pool[Math.floor(Math.random() * pool.length)];
    this.recentSeeds = [...this.recentSeeds, seed].slice(-this.memory);
    return seed;
  }

  avoidBlock() {
    if (this.recent.length === 0) return "";
    return [
      "\n\nYou posted these recently. Do not reuse their subject, opening line, or joke —",
      "pick a different asset and a different angle:",
      ...this.recent.map((post) => `- ${post}`)
    ].join("\n");
  }

  async fire() {
    try {
      const seed = this.pickSeed();
      const answer = await this.llm.ask(seed + this.avoidBlock());
      const text = limitCashtags(fitForPost(answer.text));
      if (text) this.recent = [...this.recent, text].slice(-this.memory);
      if (!text) {
        this.logger.warn("Shitposter got an empty generation; skipping this slot");
      } else if (this.bot.dryRun) {
        this.logger.info(`[dry run] would post: ${text}`);
      } else {
        const sent = await this.client.post(text);
        this.logger.info(`Posted ${sent?.data?.id ?? "unknown"}: ${text}`);
      }
    } catch (error) {
      // A failed slot is skipped, not retried: the next scheduled post is
      // never more than maxIntervalMs away, and retrying into an X 429 or an
      // LLM outage would just burn money faster.
      this.logger.warn(`Shitpost failed: ${error.message}`);
    } finally {
      this.schedule();
    }
  }
}

export function randomDelay(minMs, maxMs) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}
