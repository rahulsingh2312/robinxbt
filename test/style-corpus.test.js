import assert from "node:assert/strict";
import { test } from "node:test";
import { StyleCorpus } from "../src/style-corpus.js";

const silent = { info() {}, warn() {}, error() {} };

function corpus({ posts, status = 200, refreshMs = 60_000 }) {
  let fetches = 0;
  const instance = new StyleCorpus({
    bearerToken: "token",
    userId: "42",
    refreshMs,
    logger: silent,
    fetcher: async () => {
      fetches += 1;
      return {
        ok: status === 200,
        json: async () => ({ data: posts.map((text) => ({ text })) })
      };
    }
  });
  return { instance, count: () => fetches };
}

test("formats posts as a style block with anti-quote instructions", async () => {
  const { instance } = corpus({ posts: ["We believe in access.", "Markets  never\nsleep."] });
  const block = await instance.block();
  assert.match(block, /STYLE REFERENCE ONLY/);
  assert.match(block, /never copy a post verbatim/i);
  assert.match(block, /> We believe in access\./);
  assert.match(block, /> Markets never sleep\./);
});

test("caches within the TTL", async () => {
  const { instance, count } = corpus({ posts: ["one"] });
  await instance.block();
  await instance.block();
  assert.equal(count(), 1);
});

test("a failed fetch returns the previous block, not an error", async () => {
  const { instance } = corpus({ posts: ["one"], refreshMs: 0 });
  const first = await instance.block();
  instance.fetcher = async () => ({ ok: false, json: async () => ({}) });
  const second = await instance.block();
  assert.equal(second, first);
});

test("an empty timeline leaves the corpus empty", async () => {
  const { instance } = corpus({ posts: [] });
  assert.equal(await instance.block(), "");
});
