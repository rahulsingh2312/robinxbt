import test from "node:test";
import assert from "node:assert/strict";
import { MentionWorker } from "../src/mention-worker.js";

function worker(user) {
  return new MentionWorker({
    store: { getUser: async () => user },
    client: {},
    bot: { botUsername: "xbot" }
  });
}

const OPTED_IN = {
  publicSharing: true,
  portfolio: { hideValues: false, totalValueUsd: 1234, holdings: [{ symbol: "BTC" }] }
};

test("summarizes an opted-in portfolio inline", async () => {
  const reply = await worker(OPTED_IN).commandReply("@xbot portfolio", "alice");
  // No leading @handle: X adds the mention itself on a reply, and repeating it
  // shipped "@quantrahul @quantrahul" to production once.
  assert.match(reply, /^BTC · \$1,234$/);
});

test("withholds a portfolio from users who never opted in", async () => {
  assert.doesNotMatch(await worker(null).commandReply("@xbot portfolio", "alice"), /BTC|1,234/);
});

// X charges $0.20 for a post containing a link versus $0.015 without, so a URL
// in any reply is a 13x cost regression.
test("no reply ever contains a URL", async () => {
  const replies = await Promise.all([
    worker(OPTED_IN).commandReply("@xbot portfolio", "alice"),
    worker(null).commandReply("@xbot portfolio", "alice"),
    worker(null).commandReply("@xbot hello", "alice"),
    worker(null).commandReply("@xbot buy BTC", "alice"),
    worker(null).commandReply("@xbot buy 5 AAPL", "alice", { id: "1", author_id: "1" })
  ]);
  for (const reply of replies) {
    assert.doesNotMatch(reply, /https?:\/\/|www\.|\.com\b/, `reply contained a link: ${reply}`);
  }
});

test("a bot with no broker configured never executes an order", async () => {
  assert.match(await worker(null).commandReply("@xbot buy 5 AAPL", "alice", { id: "1", author_id: "1" }), /isn’t enabled/);
});

test("an unparseable trade asks for the exact syntax instead of guessing", async () => {
  assert.match(await worker(null).commandReply("@xbot buy BTC", "alice"), /couldn’t read that as an order/);
});
