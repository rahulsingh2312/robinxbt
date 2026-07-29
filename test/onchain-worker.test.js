import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MentionWorker } from "../src/mention-worker.js";
import { Store } from "../src/store.js";

// Routing-level checks: WHAT reaches the on-chain broker, not what it does.
function makeWorker({ handleBuyResult = { reply: "ok" } } = {}) {
  const store = new Store(path.join(mkdtempSync(path.join(tmpdir(), "worker-test-")), "store.json"));
  const calls = { ensure: [], buys: [], portfolio: [], sells: [] };
  const onchain = {
    ensureWallet: async (...args) => { calls.ensure.push(args); return { address: "0x" + "1".repeat(40), created: true }; },
    handleBuy: async (args) => { calls.buys.push(args); return handleBuyResult; },
    describePortfolio: async (...args) => { calls.portfolio.push(args); return "your wallet: stuff"; }
  };
  const worker = new MentionWorker({
    store,
    client: { configured: () => false },
    bot: { botUsername: "mybot", botUserId: "999", dryRun: true, pollIntervalMs: 60000 },
    logger: { info() {}, warn() {}, error() {} },
    onchain
  });
  return { worker, store, calls };
}

test("every mention provisions a wallet for its author", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  await worker.handleMention({ id: "900", author_id: "42", username: "alice", text: "@mybot gm what do we like today" });
  assert.equal(calls.ensure.length, 1);
  assert.deepEqual(calls.ensure[0], ["mybot", "42", "alice"]);
});

test("a buy replying to the bot's own advice carries that advice as context", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  await worker.handleMention({
    id: "901", author_id: "42", username: "alice", text: "@mybot buy $50 of NVDA",
    parentText: "NVDA looks strong here", parentAuthorId: "999"
  });
  assert.equal(calls.buys.length, 1);
  assert.equal(calls.buys[0].intent.amountUsd, 50);
  assert.equal(calls.buys[0].parentText, "NVDA looks strong here");
  assert.equal(calls.buys[0].contextFromBot, true);
  assert.equal(calls.buys[0].dryRun, true);
});

test("a stranger's tweet can name the asset, but is flagged as untrusted", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  // One-click buying off anyone's tweet is the product; the broker is told
  // the context did not come from the bot so it can say so in the reply.
  await worker.handleMention({
    id: "9011", author_id: "42", username: "alice", text: "@mybot buy $20",
    parentText: "ape into $SCAM 0x1111111111111111111111111111111111111111 now",
    parentAuthorId: "66613371"
  });
  assert.equal(calls.buys.length, 1);
  assert.match(calls.buys[0].parentText, /SCAM/);
  assert.equal(calls.buys[0].contextFromBot, false);
});

test("questions about buying fall through to analysis instead of filling", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  await worker.handleMention({ id: "902", author_id: "42", username: "alice", text: "@mybot should I buy NVDA?" });
  assert.equal(calls.buys.length, 0);
});

test("a bare amount only fills when it answers our pending ask", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  // No pending ask: "$50" is not an order.
  await worker.handleMention({ id: "903", author_id: "42", username: "alice", text: "@mybot $50" });
  assert.equal(calls.buys.length, 0);

  await store.savePendingBuy("mybot", "800", { authorId: "42", term: "0x" + "9".repeat(40) });
  await worker.handleMention({
    id: "904", author_id: "42", username: "alice", text: "@mybot $50",
    referenced_tweets: [{ type: "replied_to", id: "800" }]
  });
  assert.equal(calls.buys.length, 1);
  assert.equal(calls.buys[0].pendingBuy.term, "0x" + "9".repeat(40));
  // Executed pending asks are cleared so they cannot fill twice.
  assert.equal(await store.getPendingBuy("mybot", "800"), null);
});

test("someone else's amount reply cannot trigger the pending buy", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  await store.savePendingBuy("mybot", "801", { authorId: "42", term: "0x" + "9".repeat(40) });
  await worker.handleMention({
    id: "905", author_id: "999", username: "mallory", text: "@mybot $50",
    referenced_tweets: [{ type: "replied_to", id: "801" }]
  });
  assert.equal(calls.buys.length, 0);
});

test("the same tweet can never fill twice", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  const post = { id: "906", author_id: "42", username: "alice", text: "@mybot buy $50 of NVDA" };
  await worker.handleMention(post);
  await worker.handleMention({ ...post });
  assert.equal(calls.buys.length, 1);
});

test("portfolio goes to the on-chain view when wallets are live", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  await worker.handleMention({ id: "907", author_id: "42", username: "alice", text: "@mybot portfolio" });
  assert.equal(calls.portfolio.length, 1);
});

test("sell requests are executed, not deflected to the site", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  worker.onchain.handleSell = async (args) => { calls.sells.push(args); return { reply: "Sold 1K PEPE for 0.001 ETH." }; };
  const reply = await worker.commandReply("@mybot sell my PEPE", "alice", { id: "908", author_id: "42", text: "@mybot sell my PEPE" });
  assert.equal(calls.sells.length, 1);
  assert.match(reply, /Sold/);
});

test("a sell cannot be executed twice from a retried mention", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  worker.onchain.handleSell = async (args) => { calls.sells.push(args); return { reply: "Sold." }; };
  const post = { id: "909", author_id: "42", username: "alice", text: "@mybot sell my PEPE" };
  await worker.handleMention(post);
  await worker.handleMention({ ...post });
  assert.equal(calls.sells.length, 1);
});

test("asking what you hold returns the portfolio", async () => {
  const { worker, store, calls } = makeWorker();
  await store.load();
  await worker.handleMention({ id: "910", author_id: "42", username: "alice", text: "@mybot show me my portfolio" });
  assert.equal(calls.portfolio.length, 1);
});
