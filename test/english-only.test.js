import assert from "node:assert/strict";
import { test } from "node:test";
import { LlmClient } from "../src/llm.js";

const silent = { info() {}, warn() {}, error() {} };

function client({ replies, retryNonEnglish = true }) {
  const asked = [];
  const llm = new LlmClient({ apiKey: "k", logger: silent, retryNonEnglish });
  llm.tools = async () => [];
  llm.complete = async (messages) => {
    asked.push(messages.at(-1).content);
    return { content: replies[asked.length - 1] ?? replies.at(-1) };
  };
  return { llm, asked };
}

test("an English reply passes through untouched", async () => {
  const { llm, asked } = client({ replies: ["down bad fr, skill issue"] });
  assert.equal((await llm.ask("gm")).text, "down bad fr, skill issue");
  assert.equal(asked.length, 1);
});

test("a reply with CJK is regenerated in English", async () => {
  const { llm, asked } = client({ replies: ["nvda 下跌 today", "nvda is down today"] });
  const answer = await llm.ask("how is nvda");
  assert.equal(answer.text, "nvda is down today");
  assert.equal(asked.length, 2);
  assert.match(asked[1], /English only/);
});

test("a reply that stays non-English is dropped rather than posted", async () => {
  const { llm } = client({ replies: ["привет", "привет снова"] });
  assert.equal((await llm.ask("gm")).text, "");
});

test("accented latin text is not treated as another script", async () => {
  const { llm, asked } = client({ replies: ["café résumé naïve, mid af"] });
  assert.equal((await llm.ask("gm")).text, "café résumé naïve, mid af");
  assert.equal(asked.length, 1);
});

test("the retry is off unless asked for", async () => {
  const { llm, asked } = client({ replies: ["全是红的"], retryNonEnglish: false });
  assert.equal((await llm.ask("gm")).text, "全是红的");
  assert.equal(asked.length, 1);
});
