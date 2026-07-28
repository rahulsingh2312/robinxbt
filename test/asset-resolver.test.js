import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetResolver } from "../src/asset-resolver.js";

const REAL = { type: "token", token_type: "ERC-20", symbol: "NVDA", name: "NVIDIA • Robinhood Token", address_hash: "0x1111111111111111111111111111111111111111", is_verified_via_admin_panel: true, exchange_rate: "197.63", circulating_market_cap: "5426705" };
const FAKE = { type: "token", token_type: "ERC-20", symbol: "NVDA", name: "NVDA", address_hash: "0x2222222222222222222222222222222222222222", is_verified_via_admin_panel: false, exchange_rate: null, circulating_market_cap: null };

function resolverReturning(items) {
  return new AssetResolver({
    fetchImpl: async () => ({ ok: true, json: async () => ({ items }) })
  });
}

test("the admin-verified Robinhood token beats same-symbol impersonations", async () => {
  const resolver = resolverReturning([FAKE, REAL]);
  const asset = await resolver.resolve("NVDA");
  assert.equal(asset.address, REAL.address_hash);
  assert.equal(asset.official, true);
  assert.equal(asset.priceUsd, 197.63);
});

test("an admin-verified ticker-squatter is not treated as official", async () => {
  // Real case: "DoOnlyGoodEveryday" trades as DOGE, explorer-verified, but is
  // not a Robinhood-issued token. It may resolve as a plain memecoin — never
  // with the official flag.
  const squatter = { ...FAKE, name: "DoOnlyGoodEveryday", is_verified_via_admin_panel: true, exchange_rate: "0.0000153", circulating_market_cap: "15333" };
  const asset = await resolverReturning([squatter]).resolve("NVDA");
  assert.equal(asset.official, false);
  assert.equal(asset.address, squatter.address_hash);
});

test("an unverified, unpriced ticker resolves to nothing", async () => {
  const resolver = resolverReturning([FAKE]);
  assert.equal(await resolver.resolve("NVDA"), null);
});

test("one traded memecoin resolves; several comparable ones fail closed", async () => {
  const memeA = { ...FAKE, symbol: "WOJ", address_hash: "0x3333333333333333333333333333333333333333", exchange_rate: "0.001", circulating_market_cap: "900000" };
  const memeB = { ...FAKE, symbol: "WOJ", address_hash: "0x4444444444444444444444444444444444444444", exchange_rate: "0.002", circulating_market_cap: "800000" };
  const single = await resolverReturning([memeA]).resolve("WOJ");
  assert.equal(single.address, memeA.address_hash);
  assert.equal(single.official, false);
  const contested = await resolverReturning([memeA, memeB]).resolve("WOJ");
  assert.equal(contested.ambiguous, true);
});

test("a dominant memecoin (10x market cap) wins over dust copies", async () => {
  const big = { ...FAKE, symbol: "WOJ", address_hash: "0x3333333333333333333333333333333333333333", exchange_rate: "0.001", circulating_market_cap: "5000000" };
  const dust = { ...FAKE, symbol: "WOJ", address_hash: "0x4444444444444444444444444444444444444444", exchange_rate: "0.002", circulating_market_cap: "400000" };
  const winner = await resolverReturning([dust, big]).resolve("WOJ");
  assert.equal(winner.address, big.address_hash);
});

test("contract addresses resolve directly via the token endpoint", async () => {
  const resolver = new AssetResolver({
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => (url.includes("/tokens/") ? { type: "ERC-20", symbol: "PEPE", name: "Pepe", exchange_rate: null } : { items: [] })
    })
  });
  const asset = await resolver.resolve("0x5555555555555555555555555555555555555555");
  assert.equal(asset.symbol, "PEPE");
  assert.equal(asset.via, "address");
});
