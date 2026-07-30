import assert from "node:assert/strict";
import { test } from "node:test";
import { MentionWorker } from "../src/mention-worker.js";

const silent = { info() {}, warn() {}, error() {} };
const ADDRESS = "0x4Cb21E49C1b25fbD0E55090Efb0f2138C3228888";

function worker(token) {
  const asked = [];
  const instance = new MentionWorker({
    store: { claimMention: async () => true, getPendingBasket: async () => null, getPendingBuy: async () => null },
    client: { reply: async () => ({ data: { id: "r" } }) },
    bot: { botUsername: "peterpan", dryRun: true },
    logger: silent,
    token,
    // If the model is ever reached for this question, the test should fail.
    llm: { configured: () => true, ask: async (question) => { asked.push(question); return { text: "some model answer" }; } }
  });
  return { instance, asked };
}

const LAUNCHED = { launched: true, ticker: "PETER", address: ADDRESS };

test("the contract address comes from configuration, character for character", async () => {
  const { instance, asked } = worker(LAUNCHED);
  for (const text of [
    "@peterpan whats your ca",
    "@peterpan drop the contract address",
    "@peterpan what's ur token address",
    "@peterpan ca?",
    "@peterpan what is your token"
  ]) {
    const reply = await instance.commandReply(text, "alice", { author_id: "1", text });
    assert.ok(reply.includes(ADDRESS), `${text} -> ${reply}`);
    assert.match(reply, /PETER/);
  }
  // The model must never be involved in producing an address.
  assert.equal(asked.length, 0);
});

test("before launch it refuses to name anything and warns about impostors", async () => {
  const { instance } = worker({ launched: false, ticker: "", address: "" });
  const reply = await instance.commandReply("@peterpan whats your ca", "alice", { author_id: "1", text: "ca" });
  assert.doesNotMatch(reply, /0x[0-9a-fA-F]{6}/);
  assert.match(reply, /lying to you|No token yet/i);
});

test("a startup with a malformed address refuses to run", async () => {
  // Better to fail a deploy than to tweet a broken address at strangers.
  const previous = { addr: process.env.TOKEN_ADDRESS, ticker: process.env.TOKEN_TICKER };
  process.env.TOKEN_ADDRESS = "0x123";
  process.env.TOKEN_TICKER = "PETER";
  const { loadConfig } = await import("../src/config.js");
  assert.throws(() => loadConfig(), /TOKEN_ADDRESS must be a full 0x address/);
  process.env.TOKEN_ADDRESS = previous.addr ?? "";
  process.env.TOKEN_TICKER = previous.ticker ?? "";
});
