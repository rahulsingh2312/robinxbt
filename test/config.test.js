import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

function withEnvironment(values, callback) {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { callback(); } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("loads separate credentials for multiple X bots", () => {
  withEnvironment({
    X_BOTS_JSON: '[{"username":"alphaBot","userId":"1","userAccessToken":"a"},{"username":"betaBot","userId":"2","userAccessToken":"b"}]'
  }, () => {
    const config = loadConfig();
    assert.deepEqual(config.bots.map((bot) => [bot.botUsername, bot.botUserId, bot.userAccessToken]), [
      ["alphabot", "1", "a"],
      ["betabot", "2", "b"]
    ]);
  });
});

test("rejects duplicate bot handles", () => {
  withEnvironment({
    X_BOTS_JSON: '[{"username":"same","userId":"1"},{"username":"same","userId":"2"}]'
  }, () => {
    assert.throws(loadConfig, /Duplicate bot username/);
  });
});
