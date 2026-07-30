import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeToolMarkup } from "../src/llm.js";

test("model tool syntax is recognised as not-an-answer", () => {
  // This exact string was posted publicly as a reply.
  const leaked = '<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="robinhood_chain_can_buy"> <｜｜DSML';
  assert.equal(looksLikeToolMarkup(leaked), true);
  for (const variant of [
    '<tool_calls>',
    '{"tool_calls": [{"name":"quote"}]}',
    '<｜tool▁calls▁begin｜>',
    '<invoke name="get_quote">'
  ]) {
    assert.equal(looksLikeToolMarkup(variant), true, variant);
  }
});

test("ordinary replies are left alone", () => {
  for (const normal of [
    "nvda down 2% and you're asking a bot for permission. skill issue.",
    "bought you ~24.14 CASHCAT for $1. it's your bag now.",
    "$PETER · 0x4Cb21E49C1b25fbD0E55090Efb0f2138C3228888 — that exact string.",
    "i can't touch your wallet <- that's the point"
  ]) {
    assert.equal(looksLikeToolMarkup(normal), false, normal);
  }
});
