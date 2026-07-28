import assert from "node:assert/strict";
import { test } from "node:test";
import { GORK_NO_DATA_PROMPT, GORK_POST_SEEDS, GORK_SYSTEM_PROMPT } from "../src/persona.js";

// The persona is free to change, but the floor that keeps the account alive is
// not. These fail if a prompt rewrite drops a guard rail.
test("prompt keeps the non-negotiable floor", () => {
  assert.match(GORK_SYSTEM_PROMPT, /parody/i);
  assert.match(GORK_SYSTEM_PROMPT, /No slurs/i);
  assert.match(GORK_SYSTEM_PROMPT, /Never tell anyone to hurt themselves/i);
  assert.match(GORK_SYSTEM_PROMPT, /No guaranteed returns/i);
  assert.match(GORK_SYSTEM_PROMPT, /never present a fabricated quote/i);
  assert.match(GORK_SYSTEM_PROMPT, /never their health, family, or personal life/i);
  assert.match(GORK_SYSTEM_PROMPT, /Never speak as a Robinhood insider/i);
});

test("prompt keeps X formatting constraints", () => {
  assert.match(GORK_SYSTEM_PROMPT, /Under 240 characters/i);
  assert.match(GORK_SYSTEM_PROMPT, /ONE cashtag/i);
  assert.match(GORK_SYSTEM_PROMPT, /No links/i);
  assert.match(GORK_SYSTEM_PROMPT, /Always English/i);
});

// The specific failure that prompted the rewrite: a real Solana token with
// $344M of liquidity was dismissed as imaginary.
test("prompt forbids declaring an unfound ticker fake", () => {
  assert.match(GORK_SYSTEM_PROMPT, /NEVER say a token does not exist/i);
  assert.match(GORK_NO_DATA_PROMPT, /never claim a ticker is fake/i);
});

test("prompt grounds numbers in tool output only", () => {
  assert.match(GORK_SYSTEM_PROMPT, /Cite only numbers the tool returned this turn/i);
  assert.match(GORK_NO_DATA_PROMPT, /NEVER state a price/i);
});

test("prompt uses the parent post as the subject when given one", () => {
  assert.match(GORK_SYSTEM_PROMPT, /that post is the subject/i);
});

test("prompt asks for an occasional call to action, not a constant one", () => {
  assert.match(GORK_SYSTEM_PROMPT, /one reply in three ends in a call to action/i);
});

test("post seeds are non-empty prompts", () => {
  assert.ok(GORK_POST_SEEDS.length >= 12);
  for (const seed of GORK_POST_SEEDS) {
    assert.equal(typeof seed, "string");
    assert.ok(seed.length > 20);
  }
});
