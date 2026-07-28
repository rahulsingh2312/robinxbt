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

test("an admin-verified ticker-squatter is never treated as official", async () => {
  // Real case: "DoOnlyGoodEveryday" trades as DOGE and is explorer-verified,
  // but it is not issuer-verified, so the ticker must not resolve to it.
  const squatter = { ...FAKE, name: "DoOnlyGoodEveryday", is_verified_via_admin_panel: true, exchange_rate: "0.0000153", circulating_market_cap: "15333" };
  const asset = await resolverReturning([squatter]).resolve("NVDA");
  assert.equal(asset.unverified, true);
});

test("an unverified ticker never resolves to an address, however rich it looks", async () => {
  // Market cap is supply times price, and an attacker controls both, so a
  // ticker query can only ever answer with an issuer-verified token.
  const rich = { ...FAKE, symbol: "WOJ", address_hash: "0x3333333333333333333333333333333333333333", exchange_rate: "0.001", circulating_market_cap: "999000000000" };
  const result = await resolverReturning([rich]).resolve("WOJ");
  assert.equal(result.unverified, true);
  assert.equal(result.address, undefined);
});

test("a name match never satisfies a ticker query", async () => {
  const impostor = { ...FAKE, symbol: "XYZ", name: "NVDA Robinhood", is_verified_via_admin_panel: true, exchange_rate: "1" };
  assert.equal(await resolverReturning([impostor]).resolve("NVDA"), null);
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
