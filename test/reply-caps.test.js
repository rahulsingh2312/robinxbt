import assert from "node:assert/strict";
import { test } from "node:test";
import { MentionWorker } from "../src/mention-worker.js";

const silent = { info() {}, warn() {}, error() {} };

function worker({ perAuthorPerHour = 3, perDay = 10 } = {}) {
  const sent = [];
  const claimed = new Set();
  const instance = new MentionWorker({
    store: {
      claimMention: async (_bot, id) => (claimed.has(id) ? false : (claimed.add(id), true)),
      getPaperBook: async () => null,
      getUser: async () => null,
      getPendingBasket: async () => null
    },
    client: { reply: async (id, text) => { sent.push({ id, text }); return { data: { id: `r${id}` } }; } },
    bot: { botUsername: "peterpan", dryRun: false },
    logger: silent,
    replyCaps: { perAuthorPerHour, perDay }
  });
  // No LLM and no broker: every mention falls through to the static help text.
  return { instance, sent };
}

async function mention(instance, id, authorId) {
  await instance.handleMention({ id: String(id), text: "hello", author_id: String(authorId), username: "someone" });
}

test("replies to one author stop at the hourly cap", async () => {
  const { instance, sent } = worker({ perAuthorPerHour: 3 });
  for (let i = 0; i < 6; i += 1) await mention(instance, i, "loop-bot");
  assert.equal(sent.length, 3);
});

test("a different author is unaffected by another author's cap", async () => {
  const { instance, sent } = worker({ perAuthorPerHour: 2 });
  for (let i = 0; i < 4; i += 1) await mention(instance, `a${i}`, "noisy");
  await mention(instance, "b1", "someone-else");
  assert.equal(sent.length, 3);
  assert.equal(sent.at(-1).id, "b1");
});

test("the daily cap applies across all authors", async () => {
  const { instance, sent } = worker({ perAuthorPerHour: 100, perDay: 4 });
  for (let i = 0; i < 8; i += 1) await mention(instance, i, `author-${i}`);
  assert.equal(sent.length, 4);
});

test("entries older than the window stop counting", async () => {
  const { instance, sent } = worker({ perAuthorPerHour: 2 });
  await mention(instance, 1, "steady");
  await mention(instance, 2, "steady");
  // Age both entries past the one-hour window.
  instance.replyTimes = instance.replyTimes.map((entry) => ({ ...entry, at: entry.at - 3_700_000 }));
  await mention(instance, 3, "steady");
  assert.equal(sent.length, 3);
});

test("no caps configured means no limit", async () => {
  const { instance, sent } = worker();
  instance.replyCaps = null;
  for (let i = 0; i < 12; i += 1) await mention(instance, i, "whoever");
  assert.equal(sent.length, 12);
});
