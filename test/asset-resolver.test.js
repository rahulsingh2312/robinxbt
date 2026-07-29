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

test("an unverified ticker returns candidates for on-chain vetting", async () => {
  // The explorer picks nobody; it only proposes. Liquidity decides, because
  // market cap is supply times price and an attacker owns both.
  const real = { ...FAKE, symbol: "WOJ", address_hash: "0x3333333333333333333333333333333333333333", exchange_rate: "0.001", circulating_market_cap: "5000000" };
  const fake = { ...FAKE, symbol: "WOJ", address_hash: "0x4444444444444444444444444444444444444444", exchange_rate: "9", circulating_market_cap: "999000000000" };
  const result = await resolverReturning([real, fake]).resolve("WOJ");
  assert.equal(result.unverified, true);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((candidate) => candidate.address));
});

test("a token the explorer never priced is still found through pair liquidity", async () => {
  // The explorer only knows tokens it has priced, so anything launched
  // recently looked non-existent. The pair index knows it the moment it has
  // a pool, which is the thing that actually matters for buying.
  const resolver = new AssetResolver({
    logger: { warn() {} },
    fetchImpl: async (url) => {
      if (String(url).includes("dexscreener")) {
        return { ok: true, json: async () => ({ pairs: [
          { chainId: "robinhood", baseToken: { symbol: "IN", name: "INSIDERS.BOT", address: "0x6F572E8020247324D7B9dc15c297a32e4187dF1C" }, liquidity: { usd: 67497 }, priceUsd: "0.0002368" },
          { chainId: "base", baseToken: { symbol: "IN", name: "Other chain", address: "0xdead" }, liquidity: { usd: 999999 }, priceUsd: "1" }
        ] }) };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    }
  });
  const result = await resolver.resolve("IN");
  assert.equal(result.unverified, true);
  // Only this chain's pairs count, however deep another chain's are.
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].address, "0x6F572E8020247324D7B9dc15c297a32e4187dF1C");
});

test("an issuer-verified token still beats a deep memecoin pool", async () => {
  const resolver = new AssetResolver({
    logger: { warn() {} },
    fetchImpl: async (url) => {
      if (String(url).includes("dexscreener")) {
        return { ok: true, json: async () => ({ pairs: [
          { chainId: "robinhood", baseToken: { symbol: "NVDA", name: "fake", address: "0xfake" }, liquidity: { usd: 9_000_000 }, priceUsd: "1" }
        ] }) };
      }
      return { ok: true, json: async () => ({ items: [REAL] }) };
    }
  });
  const result = await resolver.resolve("NVDA");
  assert.equal(result.official, true);
  assert.equal(result.address, REAL.address_hash);
});
