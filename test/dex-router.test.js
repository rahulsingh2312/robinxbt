import assert from "node:assert/strict";
import { test } from "node:test";
import { DexRouter } from "../src/dex-router.js";

const silent = { info() {}, warn() {}, error() {} };

function router({ v4Out = null, v2Out = null } = {}) {
  const swapped = [];
  const venue = (name, amountOut) => ({
    addresses: { usdg: "0xusdg" },
    findBestRoute: async () => (amountOut === null ? null : { venue: name, kind: name, amountOut }),
    swap: async (signer, tokenIn, tokenOut, amountIn, options) => {
      swapped.push({ venue: name, route: options?.route?.venue });
      return { hash: `0x${name}` };
    },
    minOut: (value) => value,
    ethUsdPrice: async () => 2000,
    usdgDecimals: async () => 6
  });
  return { instance: new DexRouter({ v4: venue("v4", v4Out), v2: venue("v2", v2Out), logger: silent }), swapped };
}

test("the venue with the better fill wins", async () => {
  const { instance } = router({ v4Out: 100n, v2Out: 150n });
  assert.equal((await instance.findBestRoute("0xa", "0xb", 1n)).venue, "v2");
  const other = router({ v4Out: 200n, v2Out: 150n });
  assert.equal((await other.instance.findBestRoute("0xa", "0xb", 1n)).venue, "v4");
});

test("a token that only exists on one venue is still found", async () => {
  // Virtuals agent tokens only have v2 pairs; calling that "no market" was
  // telling people their token does not trade when it trades fine.
  const { instance } = router({ v4Out: null, v2Out: 8044n });
  const route = await instance.findBestRoute("0xa", "0xb", 1n);
  assert.equal(route.venue, "v2");
  assert.equal(route.amountOut, 8044n);
});

test("execution goes back to the venue that quoted it", async () => {
  const { instance, swapped } = router({ v4Out: 100n, v2Out: 150n });
  await instance.swap({}, "0xa", "0xb", 1n);
  assert.equal(swapped[0].venue, "v2");
  assert.equal(swapped[0].route, "v2");
});

test("no route anywhere is still no route", async () => {
  const { instance } = router({ v4Out: null, v2Out: null });
  assert.equal(await instance.findBestRoute("0xa", "0xb", 1n), null);
  await assert.rejects(() => instance.swap({}, "0xa", "0xb", 1n), /no liquidity route/);
});
