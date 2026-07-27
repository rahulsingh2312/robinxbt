import assert from "node:assert/strict";
import { test } from "node:test";
import { GORK_NO_DATA_PROMPT, GORK_POST_SEEDS, GORK_SYSTEM_PROMPT } from "../src/persona.js";

// The persona is free to change, but the floor that keeps the account alive
// is not. These assertions fail if a prompt rewrite drops the guard rails.
test("gork prompt keeps the non-negotiable floor", () => {
  assert.match(GORK_SYSTEM_PROMPT, /parody/i);
  assert.match(GORK_SYSTEM_PROMPT, /No slurs/i);
  assert.match(GORK_SYSTEM_PROMPT, /Never tell anyone to hurt themselves/i);
  assert.match(GORK_SYSTEM_PROMPT, /No guaranteed returns/i);
  assert.match(GORK_SYSTEM_PROMPT, /never present a fabricated quote/i);
});

test("gork prompt keeps X formatting constraints", () => {
  assert.match(GORK_SYSTEM_PROMPT, /under 240 characters/i);
  assert.match(GORK_SYSTEM_PROMPT, /ONE cashtag/i);
  assert.match(GORK_SYSTEM_PROMPT, /no links/i);
});

test("no-data variant forbids invented numbers", () => {
  assert.match(GORK_NO_DATA_PROMPT, /NEVER state a specific price/i);
});

test("post seeds are non-empty prompts", () => {
  assert.ok(GORK_POST_SEEDS.length >= 5);
  for (const seed of GORK_POST_SEEDS) {
    assert.equal(typeof seed, "string");
    assert.ok(seed.length > 20);
  }
});
