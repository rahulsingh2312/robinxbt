import assert from "node:assert/strict";
import { test } from "node:test";
import { AbiCoder, ZeroAddress } from "ethers";
import { Dex, DEX_ADDRESSES, NATIVE } from "../src/dex.js";

const coder = AbiCoder.defaultAbiCoder();
const TOKEN = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";

function makeDex(slippageBps = 100) {
  return new Dex({ provider: null, slippageBps });
}

test("pool keys sort currencies numerically with native ETH first", () => {
  const key = makeDex().poolKey(TOKEN, NATIVE, 500, 10);
  assert.equal(key.currency0, ZeroAddress);
  assert.equal(key.currency1, TOKEN);
  assert.equal(key.hooks, ZeroAddress);
});

test("minOut applies slippage in basis points", () => {
  assert.equal(makeDex(100).minOut(10_000n), 9_900n);
  assert.equal(makeDex(50).minOut(1_000_000n), 995_000n);
});

test("single-hop calldata decodes back to the same swap", () => {
  const dex = makeDex();
  const route = {
    kind: "single",
    poolKey: { currency0: ZeroAddress, currency1: TOKEN, fee: 500, tickSpacing: 10, hooks: ZeroAddress },
    zeroForOne: true,
    amountOut: 100n
  };
  const { commands, inputs, deadline } = dex.buildSwapCalldata(route, TOKEN, 1000n, 99n, 1234n);
  assert.equal(commands, "0x10"); // V4_SWAP
  assert.equal(deadline, 1234n);

  const [actions, params] = coder.decode(["bytes", "bytes[]"], inputs[0]);
  assert.equal(actions, "0x060c0f"); // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
  assert.equal(params.length, 3);

  const [decodedSwap] = coder.decode(["tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)"], params[0]);
  assert.equal(decodedSwap[0][1], TOKEN);
  assert.equal(decodedSwap[1], true);
  assert.equal(decodedSwap[2], 1000n);
  assert.equal(decodedSwap[3], 99n);

  const [settleCurrency, settleAmount] = coder.decode(["address", "uint256"], params[1]);
  assert.equal(settleCurrency, ZeroAddress);
  assert.equal(settleAmount, 1000n);
  const [takeCurrency, takeAmount] = coder.decode(["address", "uint256"], params[2]);
  assert.equal(takeCurrency, TOKEN);
  assert.equal(takeAmount, 99n);
});

test("two-hop calldata routes through USDG", () => {
  const dex = makeDex();
  const route = {
    kind: "path",
    tokenIn: NATIVE,
    path: [
      { intermediateCurrency: DEX_ADDRESSES.usdg, fee: 500, tickSpacing: 10, hooks: ZeroAddress, hookData: "0x" },
      { intermediateCurrency: TOKEN, fee: 3000, tickSpacing: 60, hooks: ZeroAddress, hookData: "0x" }
    ],
    amountOut: 100n
  };
  const { inputs } = dex.buildSwapCalldata(route, TOKEN, 1000n, 99n, 1n);
  const [actions, params] = coder.decode(["bytes", "bytes[]"], inputs[0]);
  assert.equal(actions, "0x070c0f"); // SWAP_EXACT_IN multi-hop
  const [decoded] = coder.decode(["tuple(address,tuple(address,uint24,int24,address,bytes)[],uint128,uint128)"], params[0]);
  assert.equal(decoded[1].length, 2);
  assert.equal(decoded[1][0][0], DEX_ADDRESSES.usdg);
  assert.equal(decoded[1][1][0], TOKEN);
});
