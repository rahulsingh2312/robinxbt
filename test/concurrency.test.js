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

test("both stores expose the same surface the worker calls", async () => {
  // A method present on the JSON store but missing on Postgres threw inside
  // the mention handler in production, so those mentions were answered with
  // nothing at all. Comparing the surfaces catches the next one.
  const { Store } = await import("../src/store.js");
  const { PostgresStore } = await import("../src/postgres-store.js");
  const required = [
    "getUser", "setUser", "claimOrder", "claimMention", "releaseMention",
    "savePendingBasket", "getPendingBasket", "clearPendingBasket",
    "savePendingBuy", "getPendingBuy", "clearPendingBuy",
    "getPaperBook", "setPaperBook", "recordSpend", "getSpend",
    "getWalletByAuthor", "setWallet", "getWalletByUsername", "createWalletIfAbsent",
    "getLastMentionId", "setLastMentionId", "getLastPostAt", "setLastPostAt"
  ];
  for (const method of required) {
    assert.equal(typeof Store.prototype[method], "function", `JSON store missing ${method}`);
    assert.equal(typeof PostgresStore.prototype[method], "function", `Postgres store missing ${method}`);
  }
});
