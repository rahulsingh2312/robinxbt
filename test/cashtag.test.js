import test from "node:test";
import assert from "node:assert/strict";
import { limitCashtags } from "../src/insiders.js";
import { MentionWorker } from "../src/mention-worker.js";

// X returns 403 "Posts are limited to a maximum of one cashtag" and drops the
// reply entirely, so this is a hard publishing constraint, not cosmetics.
test("keeps one cashtag and downgrades the rest", () => {
  assert.equal(
    limitCashtags("I like $NVDA, $AMD, and $AVGO here."),
    "I like $NVDA, AMD, and AVGO here."
  );
  assert.equal(limitCashtags("Just $NVDA."), "Just $NVDA.");
  assert.equal(limitCashtags("No tickers at all."), "No tickers at all.");
});

test("dollar amounts are not cashtags", () => {
  assert.equal(
    limitCashtags("$NVDA, AMD · $33.33 each. Reply CONFIRM."),
    "$NVDA, AMD · $33.33 each. Reply CONFIRM."
  );
});

test("replies are sanitized before they reach X", async () => {
  const posted = [];
  const worker = new MentionWorker({
    store: { claimMention: async () => true, getUser: async () => null, getPaperBook: async () => null },
    client: { reply: async (id, text) => { posted.push(text); return { data: { id: "r1" } }; } },
    bot: { botUsername: "xbot", dryRun: false },
    logger: { info() {}, warn() {}, error() {} },
    llm: { configured: () => true, ask: async () => ({ text: "Shovel sellers: $NVDA, $AMD, $AVGO." }) }
  });
  await worker.handleMention({ id: "1", author_id: "42", username: "alice", text: "@xbot thesis?" });
  assert.equal(posted.length, 1);
  assert.equal((posted[0].match(/\$[A-Za-z]/g) ?? []).length, 1);
});

test("a failed reply releases the claim so it can be retried", async () => {
  const handled = new Set();
  let attempts = 0;
  const worker = new MentionWorker({
    store: {
      claimMention: async (bot, id) => (handled.has(id) ? false : (handled.add(id), true)),
      releaseMention: async (bot, id) => { handled.delete(id); },
      getUser: async () => null,
      getPaperBook: async () => null
    },
    client: {
      reply: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("X API 429: rate limited");
        return { data: { id: "r1" } };
      }
    },
    bot: { botUsername: "xbot", dryRun: false },
    logger: { info() {}, warn() {}, error() {} }
  });
  const post = { id: "7", author_id: "42", username: "alice", text: "@xbot hi" };
  await assert.rejects(worker.handleMention(post), /429/);
  await worker.handleMention(post); // poll fallback retries
  assert.equal(attempts, 2);
});
