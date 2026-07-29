import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { WalletVault } from "../src/wallet-vault.js";

function tempStore() {
  return new Store(path.join(mkdtempSync(path.join(tmpdir(), "conc-")), "store.json"));
}

test("concurrent first mentions from one user converge on a single wallet", async () => {
  const store = tempStore();
  await store.load();
  const vault = new WalletVault("e".repeat(64));
  // Ten mentions land at once for a brand-new author. If any of them wins a
  // separate wallet, funds deposited to the address we already advertised
  // become unreachable.
  const wallets = await Promise.all(
    Array.from({ length: 10 }, () => vault.ensureWallet(store, "mybot", "555", "carol"))
  );
  const addresses = new Set(wallets.map((wallet) => wallet.address));
  assert.equal(addresses.size, 1, `minted ${addresses.size} wallets`);
  assert.equal(wallets.filter((wallet) => wallet.created).length, 1);
  const stored = await store.getWalletByAuthor("mybot", "555");
  assert.equal(stored.address, wallets[0].address);
});

test("different users still get different wallets under load", async () => {
  const store = tempStore();
  await store.load();
  const vault = new WalletVault("f".repeat(64));
  const wallets = await Promise.all(
    Array.from({ length: 20 }, (_, index) => vault.ensureWallet(store, "mybot", `u${index}`, `user${index}`))
  );
  assert.equal(new Set(wallets.map((wallet) => wallet.address)).size, 20);
});
