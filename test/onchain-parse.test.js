import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBuyIntent, parseUsdAmount } from "../src/onchain-broker.js";
import { extractAssetTerms } from "../src/asset-resolver.js";

test("parses buy with dollar amount and ticker", () => {
  const intent = parseBuyIntent("@mybot buy $50 of NVDA", "mybot");
  assert.deepEqual(intent, { wantsBuy: true, amountUsd: 50, term: "NVDA" });
});

test("parses cashtags, k-suffix amounts, and contract addresses", () => {
  assert.equal(parseBuyIntent("buy $1.5k of $pepe", "mybot").amountUsd, 1500);
  assert.equal(parseBuyIntent("buy $1.5k of $pepe", "mybot").term, "PEPE");
  const ca = "0x" + "d0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
  assert.equal(parseBuyIntent(`ape into ${ca} for 20 bucks`, "mybot").term, ca);
  assert.equal(parseBuyIntent(`ape into ${ca} for 20 bucks`, "mybot").amountUsd, 20);
});

test("an address's digits are never read as a dollar amount", () => {
  // The digit runs inside a contract address used to parse as ~1e39 dollars.
  const intent = parseBuyIntent("buy 0x1111111111111111111111111111111111111111", "mybot");
  assert.equal(intent.amountUsd, null);
});

test("casual phrases that merely mention money never order a buy", () => {
  // These may still read as a bare amount, which only ever completes a buy
  // the bot itself asked the same author to size. None of them is an order.
  for (const text of [
    "@mybot grab a coffee, that will be $5",
    "@mybot get me out of here for $10",
    "@mybot lol send it $25",
    "@mybot yolo $100"
  ]) {
    assert.equal(parseBuyIntent(text, "mybot").wantsBuy, false, text);
  }
});

test("questions never execute, even carrying an amount", () => {
  assert.equal(parseBuyIntent("@mybot would you buy $50 of NVDA here?", "mybot"), null);
  assert.equal(parseBuyIntent("@mybot should I buy NVDA?", "mybot"), null);
});

test("buy without amount or asset still reads as intent", () => {
  const bare = parseBuyIntent("@mybot buy it", "mybot");
  assert.equal(bare.wantsBuy, true);
  assert.equal(bare.amountUsd, null);
  assert.equal(bare.term, null);
});

test("a bare amount reply is an amount, not an order", () => {
  const amountOnly = parseBuyIntent("$50", "mybot");
  assert.equal(amountOnly.wantsBuy, false);
  assert.equal(amountOnly.amountUsd, 50);
  assert.equal(parseBuyIntent("50 bucks", "mybot").amountUsd, 50);
});

test("chatter without buy words or amounts is not an intent", () => {
  assert.equal(parseBuyIntent("what do you think of NVDA earnings", "mybot"), null);
  assert.equal(parseBuyIntent("", "mybot"), null);
});

test("filler words after the verb do not become tickers", () => {
  assert.equal(parseBuyIntent("buy some for me", "mybot").term, null);
  assert.equal(parseBuyIntent("buy that", "mybot").term, null);
});

test("parseUsdAmount handles the usual tweet formats", () => {
  assert.equal(parseUsdAmount("$25"), 25);
  assert.equal(parseUsdAmount("25$"), 25);
  assert.equal(parseUsdAmount("$2,500.50"), 2500.5);
  assert.equal(parseUsdAmount("1k usd"), 1000);
  assert.equal(parseUsdAmount("send it"), null);
});

test("extractAssetTerms prefers addresses, then cashtags, and drops junk", () => {
  const terms = extractAssetTerms("LFG buy $NVDA or PEPE, ca 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC NFA DYOR");
  assert.equal(terms[0], "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
  assert.deepEqual(terms.slice(1, 3), ["NVDA", "PEPE"]);
  assert.ok(!terms.includes("NFA"));
  assert.ok(!terms.includes("LFG"));
});
