import assert from "node:assert/strict";
import { test } from "node:test";
import { MentionWorker } from "../src/mention-worker.js";

const silent = { info() {}, warn() {}, error() {} };

function worker({ getPost } = {}) {
  const asked = [];
  const instance = new MentionWorker({
    store: {
      claimMention: async () => true,
      getPaperBook: async () => null,
      getUser: async () => null,
      getPendingBasket: async () => null
    },
    client: { reply: async () => ({ data: { id: "r1" } }), ...(getPost ? { getPost } : {}) },
    bot: { botUsername: "peterpan", dryRun: true },
    logger: silent,
    llm: { configured: () => true, ask: async (question) => { asked.push(question); return { text: "reply" }; } }
  });
  return { instance, asked };
}

test("an expanded parent post is handed to the model as the subject", async () => {
  const { instance, asked } = worker();
  await instance.handleMention({
    id: "1",
    text: "@peterpan is this true",
    author_id: "9",
    referenced_tweets: [{ id: "parent-1", type: "replied_to" }],
    parentText: "$PONS discounts available today, dont fade 100m soon"
  });
  assert.match(asked[0], /Untrusted quoted post/);
  assert.match(asked[0], /\$PONS discounts available today/);
  assert.match(asked[0], /Their mention: is this true/);
});

test("a missing parent is fetched once by id", async () => {
  const fetched = [];
  const { instance, asked } = worker({
    getPost: async (id) => { fetched.push(id); return { data: { text: "the parent claim" } }; }
  });
  await instance.handleMention({
    id: "2",
    text: "@peterpan is this true",
    author_id: "9",
    referenced_tweets: [{ id: "parent-2", type: "replied_to" }]
  });
  assert.deepEqual(fetched, ["parent-2"]);
  assert.match(asked[0], /the parent claim/);
});

test("a quoted post counts as context too", async () => {
  const { instance, asked } = worker({ getPost: async () => ({ data: { text: "quoted claim" } }) });
  await instance.handleMention({
    id: "3",
    text: "@peterpan thoughts",
    author_id: "9",
    referenced_tweets: [{ id: "q1", type: "quoted" }]
  });
  assert.match(asked[0], /quoted claim/);
});

test("a standalone mention is asked without context framing", async () => {
  const { instance, asked } = worker();
  await instance.handleMention({ id: "4", text: "@peterpan gm", author_id: "9" });
  assert.equal(asked[0], "gm");
});

test("a failed parent fetch still produces a reply", async () => {
  const { instance, asked } = worker({ getPost: async () => { throw new Error("X API 404"); } });
  await instance.handleMention({
    id: "5",
    text: "@peterpan is this true",
    author_id: "9",
    referenced_tweets: [{ id: "gone", type: "replied_to" }]
  });
  assert.equal(asked[0], "is this true");
});

test("a retweet reference is not treated as context", async () => {
  const fetched = [];
  const { instance } = worker({ getPost: async (id) => { fetched.push(id); return { data: { text: "rt" } }; } });
  await instance.handleMention({
    id: "6",
    text: "@peterpan gm",
    author_id: "9",
    referenced_tweets: [{ id: "rt1", type: "retweeted" }]
  });
  assert.deepEqual(fetched, []);
});
