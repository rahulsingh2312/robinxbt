import assert from "node:assert/strict";
import { test } from "node:test";
import { randomDelay, Shitposter } from "../src/shitposter.js";

const silent = { info() {}, warn() {}, error() {} };

function poster({ dryRun, text }) {
  const calls = { posted: [] };
  const shitposter = new Shitposter({
    client: { post: async (body) => { calls.posted.push(body); return { data: { id: "1" } }; } },
    llm: { ask: async () => ({ text }) },
    bot: { botUsername: "gork", dryRun },
    seeds: ["seed"],
    minIntervalMs: 1,
    maxIntervalMs: 2,
    logger: silent
  });
  // fire() reschedules itself; neuter that so tests do not leak timers.
  shitposter.schedule = () => {};
  return { shitposter, calls };
}

test("randomDelay stays within bounds", () => {
  for (let i = 0; i < 200; i += 1) {
    const delay = randomDelay(100, 200);
    assert.ok(delay >= 100 && delay <= 200);
  }
});

test("dry run never posts", async () => {
  const { shitposter, calls } = poster({ dryRun: true, text: "buy $HOOD you cowards" });
  await shitposter.fire();
  assert.equal(calls.posted.length, 0);
});

test("live mode posts with cashtags limited to one", async () => {
  const { shitposter, calls } = poster({ dryRun: false, text: "buy $HOOD and $NVDA and $TSLA" });
  await shitposter.fire();
  assert.equal(calls.posted.length, 1);
  assert.equal(calls.posted[0], "buy $HOOD and NVDA and TSLA");
});

test("an empty generation is skipped, not posted", async () => {
  const { shitposter, calls } = poster({ dryRun: false, text: "" });
  await shitposter.fire();
  assert.equal(calls.posted.length, 0);
});

test("recent posts are fed back as an avoid-list", async () => {
  const asked = [];
  const { shitposter } = poster({ dryRun: false, text: "nvda down 5% again" });
  shitposter.llm = { ask: async (prompt) => { asked.push(prompt); return { text: "nvda down 5% again" }; } };
  await shitposter.fire();
  await shitposter.fire();
  assert.ok(!asked[0].includes("Do not reuse"), "first post has nothing to avoid");
  assert.match(asked[1], /Do not reuse their subject/);
  assert.match(asked[1], /- nvda down 5% again/);
});

test("the avoid-list is capped at the memory size", async () => {
  const { shitposter } = poster({ dryRun: true, text: "x" });
  shitposter.memory = 2;
  shitposter.llm = { ask: async () => ({ text: `post ${shitposter.recent.length}` }) };
  for (let i = 0; i < 5; i += 1) await shitposter.fire();
  assert.equal(shitposter.recent.length, 2);
});

test("seed rotation avoids repeating a recent seed", async () => {
  const asked = [];
  const { shitposter } = poster({ dryRun: true, text: "x" });
  shitposter.seeds = ["alpha", "beta"];
  shitposter.llm = { ask: async (prompt) => { asked.push(prompt.split("\n")[0]); return { text: "x" }; } };
  await shitposter.fire();
  await shitposter.fire();
  assert.notEqual(asked[0], asked[1]);
});

test("a single-seed rotation still fires", async () => {
  const { shitposter, calls } = poster({ dryRun: false, text: "solo" });
  await shitposter.fire();
  await shitposter.fire();
  assert.equal(calls.posted.length, 2);
});

test("a broker or LLM failure does not throw out of fire()", async () => {
  const { shitposter, calls } = poster({ dryRun: false, text: "x" });
  shitposter.llm = { ask: async () => { throw new Error("LLM down"); } };
  await shitposter.fire();
  assert.equal(calls.posted.length, 0);
});
