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
  assert.match(GORK_SYSTEM_PROMPT, /Never speak as a brokerage insider/i);
  assert.match(GORK_SYSTEM_PROMPT, /drop the bit for one reply/i);
});

test("prompt keeps X formatting constraints", () => {
  assert.match(GORK_SYSTEM_PROMPT, /Under 240 characters/i);
  assert.match(GORK_SYSTEM_PROMPT, /ONE cashtag/i);
  assert.match(GORK_SYSTEM_PROMPT, /No links/i);
  assert.match(GORK_SYSTEM_PROMPT, /Always English/i);
});

// The bot plugged Robinhood in ~7 of 10 replies under a frequency instruction.
// The rule is now conditional, which a model can actually evaluate.
test("robinhood is gated on the user raising it, not on a frequency", () => {
  assert.match(GORK_SYSTEM_PROMPT, /Do NOT mention Robinhood, HOOD, or "download the app" unless/i);
  assert.doesNotMatch(GORK_SYSTEM_PROMPT, /one (reply|post) in (three|five)/i);
  assert.doesNotMatch(GORK_SYSTEM_PROMPT, /call to action/i);
});

// A real Solana token with $344M of liquidity was dismissed as imaginary.
test("prompt forbids declaring an unfound ticker fake or inventing one", () => {
  assert.match(GORK_SYSTEM_PROMPT, /NEVER say a token does not exist/i);
  assert.match(GORK_SYSTEM_PROMPT, /Do not invent symbols/i);
  assert.match(GORK_NO_DATA_PROMPT, /never claim a ticker is fake/i);
});

test("prompt grounds numbers in tool output only", () => {
  assert.match(GORK_SYSTEM_PROMPT, /Cite only numbers the tool returned this turn/i);
  assert.match(GORK_NO_DATA_PROMPT, /NEVER state a price/i);
});

test("prompt makes roasting the primary mode", () => {
  assert.match(GORK_SYSTEM_PROMPT, /THE ROAST IS THE POINT/);
  assert.match(GORK_SYSTEM_PROMPT, /genuinely mean, crude, and specific/i);
});

test("prompt uses the parent post as the subject when given one", () => {
  assert.match(GORK_SYSTEM_PROMPT, /that post is the subject/i);
});

test("post seeds are non-empty and mostly not about robinhood", () => {
  assert.ok(GORK_POST_SEEDS.length >= 12);
  for (const seed of GORK_POST_SEEDS) {
    assert.equal(typeof seed, "string");
    assert.ok(seed.length > 20);
  }
  const plugs = GORK_POST_SEEDS.filter((seed) => /robinhood|hood/i.test(seed));
  assert.ok(plugs.length <= 2, `too many robinhood seeds: ${plugs.length}`);
});

test("prompt bars date guesses and trailing ticker lists", () => {
  assert.match(GORK_SYSTEM_PROMPT, /Never state the current date, year, or quarter/i);
  assert.match(GORK_SYSTEM_PROMPT, /Never tack a list of tickers onto the end/i);
});
