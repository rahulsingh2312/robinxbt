import assert from "node:assert/strict";
import { test } from "node:test";
import { GORK_NO_DATA_PROMPT, GORK_POST_SEEDS, GORK_SYSTEM_PROMPT, tokenAwarenessPrompt } from "../src/persona.js";

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
  assert.match(GORK_SYSTEM_PROMPT, /Never end a reply with a bare cashtag/i);
});

test("the persona forbids treating an asset class as a ticker", () => {
  // A real reply went hunting for a token called ROBINHOOD because someone
  // tweeted "ROBINHOOD TOKENS" in caps, then roasted the honeypot it found.
  assert.match(GORK_SYSTEM_PROMPT, /capitalised does not make it a ticker/i);
  assert.match(GORK_SYSTEM_PROMPT, /asset class, not a symbol/i);
});

test("the persona knows what to do when a post is about the bot itself", () => {
  assert.match(GORK_SYSTEM_PROMPT, /WHEN THEY ARE TALKING ABOUT YOU/);
  assert.match(GORK_SYSTEM_PROMPT, /promoting you is doing you a favour/i);
  assert.match(GORK_SYSTEM_PROMPT, /they hold the keys/i);
});

test("endorsements get a victory lap, not a token lookup", () => {
  assert.match(GORK_SYSTEM_PROMPT, /Endorsements sound like/i);
  assert.match(GORK_SYSTEM_PROMPT, /no ticker in a compliment/i);
});

test("a launched token stops the account denying it exists", () => {
  // On launch day the bot replied "i don't launch tokens, deploy contracts,
  // or sell presales" about its own token.
  const prompt = tokenAwarenessPrompt({ launched: true, ticker: "PETERPAN", address: "0x8B92eEB78E4D918291441C9eA808b92276A0B47A" });
  assert.match(prompt, /You launched \$PETERPAN/);
  assert.match(prompt, /Never deny having a token/i);
  // It still must never type the address itself.
  assert.match(prompt, /Never type its address/i);
  assert.doesNotMatch(prompt, /0x8B92/);
});

test("before launch it says so and warns about impostors", () => {
  const prompt = tokenAwarenessPrompt({ launched: false });
  assert.match(prompt, /have not launched/i);
  assert.match(prompt, /scam/i);
});
