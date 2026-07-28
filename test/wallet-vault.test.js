import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WalletVault } from "../src/wallet-vault.js";
import { Store } from "../src/store.js";

const KEY = "a".repeat(64);

function tempStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "vault-test-"));
  return new Store(path.join(dir, "store.json"));
}

test("rejects a weak or missing encryption key", () => {
  assert.throws(() => new WalletVault(""), /64 hex/);
  assert.throws(() => new WalletVault("abc123"), /64 hex/);
  assert.throws(() => new WalletVault("z".repeat(64)), /64 hex/);
});

test("encrypts and decrypts a private key round-trip", () => {
  const vault = new WalletVault(KEY);
  const record = vault.encrypt("0xdeadbeef");
  assert.equal(vault.decrypt(record), "0xdeadbeef");
  assert.notEqual(record.ct, "0xdeadbeef");
});

test("a different key cannot decrypt", () => {
  const record = new WalletVault(KEY).encrypt("0xsecret");
  assert.throws(() => new WalletVault("b".repeat(64)).decrypt(record));
});

test("ensureWallet creates once and is idempotent per author id", async () => {
  const vault = new WalletVault(KEY);
  const store = tempStore();
  await store.load();
  const first = await vault.ensureWallet(store, "mybot", "111", "alice");
  const second = await vault.ensureWallet(store, "mybot", "111", "alice");
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.address, second.address);
  assert.match(first.address, /^0x[0-9a-fA-F]{40}$/);
});

test("wallet is findable by username and follows handle changes", async () => {
  const vault = new WalletVault(KEY);
  const store = tempStore();
  await store.load();
  const created = await vault.ensureWallet(store, "mybot", "222", "Bob");
  const byName = await store.getWalletByUsername("mybot", "bob");
  assert.equal(byName.address, created.address);
  assert.equal(byName.authorId, "222");

  // Handle changes; the numeric ID keeps the same wallet.
  await vault.ensureWallet(store, "mybot", "222", "bobby");
  const renamed = await store.getWalletByUsername("mybot", "bobby");
  assert.equal(renamed.address, created.address);
});

test("stored key material is encrypted, never plaintext", async () => {
  const vault = new WalletVault(KEY);
  const store = tempStore();
  await store.load();
  await vault.ensureWallet(store, "mybot", "333", "carol");
  const record = await store.getWalletByAuthor("mybot", "333");
  assert.equal(typeof record.key.ct, "string");
  assert.ok(!JSON.stringify(record).includes("privateKey"));
  const signerKey = vault.privateKeyOf(record);
  assert.match(signerKey, /^0x[0-9a-f]{64}$/);
});
